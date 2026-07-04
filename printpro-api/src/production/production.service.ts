import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  ProductionStatus,
  ProofStatus,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductionJobDto,
  UpdateProductionJobDto,
} from './dto/production.dto';

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  // Создать задание из заказа
  async create(dto: CreateProductionJobDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId: dto.companyId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    // Барьер согласования: без утверждённого макета задание не создаётся
    await this.ensureDesignApproved(dto.companyId, dto.orderId);

    return this.prisma.productionJob.create({
      data: {
        companyId: dto.companyId,
        orderId: dto.orderId,
        assignedUserId: dto.assignedUserId,
        printer: dto.printer,
        equipmentId: dto.equipmentId,
        priority: dto.priority ?? 0,
        note: dto.note,
      },
      include: this.includes(),
    });
  }

  // Список заданий (доска производства), фильтр по статусу
  findAll(companyId: string, status?: ProductionStatus) {
    return this.prisma.productionJob.findMany({
      where: { companyId, deletedAt: null, ...(status ? { status } : {}) },
      include: this.includes(),
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // Обновить назначение/принтер/приоритет/заметку
  async update(id: string, companyId: string, dto: UpdateProductionJobDto) {
    await this.ensure(id, companyId);
    return this.prisma.productionJob.update({
      where: { id },
      data: {
        assignedUserId: dto.assignedUserId,
        printer: dto.printer,
        equipmentId: dto.equipmentId,
        priority: dto.priority,
        note: dto.note,
      },
      include: this.includes(),
    });
  }

  // Сменить статус + синхронизировать статус заказа
  async updateStatus(
    id: string,
    companyId: string,
    status: ProductionStatus,
    defectReason?: string,
    userId?: string,
  ) {
    const job = await this.ensure(id, companyId);

    const data: {
      status: ProductionStatus;
      startedAt?: Date;
      completedAt?: Date | null;
      defectReason?: string | null;
    } = { status };

    // Первый переход из «ожидает» в работу — фиксируем старт.
    // Барьер согласования: стартовать печать по неутверждённому макету нельзя.
    if (status !== ProductionStatus.PENDING && !job.startedAt) {
      if (status !== ProductionStatus.CANCELLED) {
        await this.ensureDesignApproved(companyId, job.orderId);
      }
      data.startedAt = new Date();
    }
    // Готово — фиксируем завершение, иначе сбрасываем
    data.completedAt =
      status === ProductionStatus.COMPLETED ? new Date() : null;

    // Брак/переделка — сохраняем причину; иначе очищаем
    data.defectReason =
      status === ProductionStatus.REWORK ? (defectReason ?? null) : null;

    const updated = await this.prisma.productionJob.update({
      where: { id },
      data,
      include: this.includes(),
    });

    // При завершении — авто-списание материалов со склада (один раз)
    if (status === ProductionStatus.COMPLETED && !job.materialsWrittenOff) {
      await this.writeOffMaterials(job.id, job.orderId, userId);
    }

    // Откат материалов при выходе из «готово» (переделка/пауза/отмена): возвращаем
    // ранее списанное и снимаем флаг — чтобы повторное «готово» списало заново и
    // учёт материалов не «дрейфовал» (списал один прогон, не списал второй).
    if (
      job.status === ProductionStatus.COMPLETED &&
      status !== ProductionStatus.COMPLETED &&
      job.materialsWrittenOff
    ) {
      await this.reverseMaterials(job.id, job.orderId, userId);
    }

    // Подтягиваем статус заказа за производством
    await this.syncOrderStatus(job.orderId);

    return updated;
  }

  // Авто-списание материалов по спецификации услуг заказа
  private async writeOffMaterials(
    jobId: string,
    orderId: string,
    userId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { service: { include: { materials: true } } } },
      },
    });
    if (!order?.branchId) return; // некуда списывать без филиала
    const branchId = order.branchId;

    // Сводим расход по товарам: Σ (норма × кол-во услуги)
    const need = new Map<string, number>();
    for (const it of order.items) {
      const mats = it.service?.materials ?? [];
      for (const m of mats) {
        const qty = Number(m.qtyPerUnit) * Number(it.quantity);
        if (qty > 0) need.set(m.productId, (need.get(m.productId) ?? 0) + qty);
      }
    }

    // Захват права на списание и само списание — в одной транзакции. Флаг
    // переводим false→true атомарно (updateMany + проверка count): второй
    // параллельный запрос получит count=0 и материалы не спишутся дважды.
    // При сбое транзакция откатится вместе с флагом — списание можно повторить.
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.productionJob.updateMany({
        where: { id: jobId, materialsWrittenOff: false },
        data: { materialsWrittenOff: true },
      });
      if (claim.count === 0) return; // уже списано параллельно

      for (const [productId, qty] of need) {
        // Не уходим в минус: списываем только фактически доступное (как в кассе
        // и на складе). Недостача остатка = сигнал незанесённой приёмки, а не
        // повод портить остаток отрицательным значением (ломает отчёты/оповещения).
        const stock = await tx.stock.findUnique({
          where: { productId_branchId: { productId, branchId } },
          select: { quantity: true },
        });
        const before = stock ? Number(stock.quantity) : 0;
        const dec = Math.min(before, qty);
        if (dec <= 0) continue; // нечего списывать — движение не пишем
        const after = Number((before - dec).toFixed(3));
        await tx.stock.update({
          where: { productId_branchId: { productId, branchId } },
          data: { quantity: after },
        });
        await tx.stockMovement.create({
          data: {
            companyId: order.companyId,
            productId,
            branchId,
            type: StockMovementType.WRITE_OFF,
            quantity: dec,
            beforeQty: before,
            afterQty: after,
            reason: `Производство по заказу №${order.orderNumber}`,
            orderId: order.id,
            userId: userId ?? null,
          },
        });
      }
    });
  }

  // Возврат материалов на склад при откате завершённого задания. Возвращаем
  // ЧИСТЫЙ остаток списанного (списания производством минус уже сделанные
  // возвраты) — иначе несколько циклов «готово↔переделка» переприходовали бы
  // лишнее. Флаг снимаем атомарно (повторный/параллельный вызов → count=0).
  private async reverseMaterials(
    jobId: string,
    orderId: string,
    userId?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.productionJob.updateMany({
        where: { id: jobId, materialsWrittenOff: true },
        data: { materialsWrittenOff: false },
      });
      if (claim.count === 0) return;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { branchId: true, companyId: true, orderNumber: true },
      });
      if (!order?.branchId) return;
      const branchId = order.branchId;

      // Списано производством по заказу и уже возвращено — из журнала движений.
      // Прим.: списание привязано к заказу (не к заданию), поэтому при нескольких
      // заданиях на один заказ откат вернёт материалы всего заказа (редкий случай).
      const [outMoves, inMoves] = await Promise.all([
        tx.stockMovement.groupBy({
          by: ['productId'],
          where: {
            orderId,
            companyId: order.companyId,
            type: StockMovementType.WRITE_OFF,
            reason: { startsWith: 'Производство по заказу' },
          },
          _sum: { quantity: true },
        }),
        tx.stockMovement.groupBy({
          by: ['productId'],
          where: {
            orderId,
            companyId: order.companyId,
            type: StockMovementType.IN,
            reason: { startsWith: 'Возврат материалов (переделка)' },
          },
          _sum: { quantity: true },
        }),
      ]);
      const returned = new Map(
        inMoves.map((m) => [m.productId, Number(m._sum.quantity ?? 0)]),
      );

      for (const m of outMoves) {
        const net = Number(
          (
            Number(m._sum.quantity ?? 0) - (returned.get(m.productId) ?? 0)
          ).toFixed(3),
        );
        if (net <= 0) continue; // уже возвращено
        await tx.stock.upsert({
          where: { productId_branchId: { productId: m.productId, branchId } },
          create: { productId: m.productId, branchId, quantity: net },
          update: { quantity: { increment: net } },
        });
        const cur = await tx.stock.findUnique({
          where: { productId_branchId: { productId: m.productId, branchId } },
        });
        const after = cur ? Number(cur.quantity) : net;
        const before = Number((after - net).toFixed(3));
        await tx.stockMovement.create({
          data: {
            companyId: order.companyId,
            productId: m.productId,
            branchId,
            type: StockMovementType.IN,
            quantity: net,
            beforeQty: before,
            afterQty: after,
            reason: `Возврат материалов (переделка) по заказу №${order.orderNumber}`,
            orderId,
            userId: userId ?? null,
          },
        });
      }
    });
  }

  async remove(id: string, companyId: string) {
    await this.ensure(id, companyId);
    // Мягкое удаление — чтобы синхронизировалось между узлами
    await this.prisma.productionJob.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // Фото готового результата
  async setResultPhoto(id: string, companyId: string, url: string) {
    await this.ensure(id, companyId);
    return this.prisma.productionJob.update({
      where: { id },
      data: { resultPhotoUrl: url },
      include: this.includes(),
    });
  }

  // ---------- helpers ----------
  // Барьер согласования макета (дублирует orders.ensureDesignApproved, чтобы не
  // тянуть кросс-модульную зависимость): если у заказа есть активные макеты и ни
  // один не утверждён — печать запрещена. Отключается requireDesignApproval='0'.
  private async ensureDesignApproved(companyId: string, orderId: string) {
    const setting = await this.prisma.setting.findFirst({
      where: { companyId, key: 'requireDesignApproval' },
    });
    if (setting?.value === '0') return;
    const proofs = await this.prisma.designProof.findMany({
      where: { orderId, deletedAt: null },
      select: { status: true },
    });
    // Активны все макеты, кроме отклонённых. Печать разрешена только когда
    // КАЖДЫЙ активный макет согласован (а не «хотя бы один»).
    const active = proofs.filter((p) => p.status !== ProofStatus.REJECTED);
    if (active.length === 0) return;
    if (active.every((p) => p.status === ProofStatus.APPROVED)) return;
    throw new BadRequestException(
      'Не все макеты заказа согласованы — запуск производства заблокирован. ' +
        'Утвердите все макеты (статус «Согласован») или отключите барьер в настройках.',
    );
  }

  private includes() {
    return {
      order: {
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          deadline: true,
          client: { select: { fullName: true, phone: true } },
        },
      },
      assignedUser: { select: { id: true, fullName: true } },
      equipment: { select: { id: true, name: true, status: true } },
    };
  }

  private async ensure(id: string, companyId: string) {
    const job = await this.prisma.productionJob.findFirst({
      where: { id, companyId },
    });
    if (!job) throw new NotFoundException('Задание не найдено');
    return job;
  }

  // Если все задания заказа готовы — заказ READY; если есть в работе — IN_PROGRESS
  private async syncOrderStatus(orderId: string) {
    const jobs = await this.prisma.productionJob.findMany({
      where: { orderId },
      select: { status: true },
    });
    if (jobs.length === 0) return;

    const active = jobs.filter((j) => j.status !== ProductionStatus.CANCELLED);
    if (active.length === 0) return;

    const allDone = active.every(
      (j) => j.status === ProductionStatus.COMPLETED,
    );
    const anyWorking = active.some(
      (j) =>
        j.status !== ProductionStatus.PENDING &&
        j.status !== ProductionStatus.COMPLETED,
    );

    let next: OrderStatus | null = null;
    if (allDone) next = OrderStatus.READY;
    else if (anyWorking) next = OrderStatus.IN_PROGRESS;

    if (next) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      // Терминальные статусы не откатываем: выданный/отменённый заказ не должен
      // «воскресать» в READY/IN_PROGRESS из-за позднего задания производства.
      if (
        order &&
        order.status !== next &&
        order.status !== OrderStatus.DELIVERED &&
        order.status !== OrderStatus.CANCELLED
      ) {
        await this.prisma.$transaction([
          this.prisma.order.update({
            where: { id: orderId },
            data: { status: next },
          }),
          this.prisma.orderStatusHistory.create({
            data: { orderId, status: next, reason: 'авто (производство)' },
          }),
        ]);
      }
    }
  }
}
