import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ProductionStatus,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateProductionJobDto,
  UpdateProductionJobDto,
} from './dto/production.dto';

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateProductionJobDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId: dto.companyId, deletedAt: null },
    });
    if (!order) throw new NotFoundException('Order not found');
    await this.ensureUser(dto.companyId, dto.assignedUserId);
    await this.ensureEquipment(dto.companyId, dto.equipmentId);

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

  findAll(companyId: string, status?: ProductionStatus) {
    return this.prisma.productionJob.findMany({
      where: { companyId, deletedAt: null, ...(status ? { status } : {}) },
      include: this.includes(),
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async update(id: string, companyId: string, dto: UpdateProductionJobDto) {
    await this.ensure(id, companyId);
    await this.ensureUser(companyId, dto.assignedUserId);
    await this.ensureEquipment(companyId, dto.equipmentId);
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

    if (status !== ProductionStatus.PENDING && !job.startedAt) {
      data.startedAt = new Date();
    }
    data.completedAt = status === ProductionStatus.COMPLETED ? new Date() : null;
    data.defectReason =
      status === ProductionStatus.REWORK ? defectReason ?? null : null;

    let updated;
    if (status === ProductionStatus.COMPLETED && !job.materialsWrittenOff) {
      // Списание материалов и перевод в COMPLETED — в ОДНОЙ транзакции (сначала
      // списываем): нехватка остатка откатывает завершение, job не остаётся
      // COMPLETED без списания/снимка себестоимости (P0-8).
      updated = await this.prisma.$transaction(async (tx) => {
        await this.writeOffMaterials(tx, job.id, job.orderId, userId);
        return tx.productionJob.update({
          where: { id },
          data,
          include: this.includes(),
        });
      });
    } else if (status !== ProductionStatus.COMPLETED && job.materialsWrittenOff) {
      // Уход из COMPLETED (отмена/переделка/возврат в работу): списанные материалы
      // надо вернуть на склад — иначе остатки занижены, а леджер расходится (P1-97).
      // Реверс и смена статуса — в ОДНОЙ транзакции, идемпотентно.
      updated = await this.prisma.$transaction(async (tx) => {
        await this.reverseMaterialWriteOff(tx, job, userId);
        return tx.productionJob.update({
          where: { id },
          data,
          include: this.includes(),
        });
      });
    } else {
      updated = await this.prisma.productionJob.update({
        where: { id },
        data,
        include: this.includes(),
      });
    }

    await this.syncOrderStatus(job.orderId);
    return updated;
  }

  // Списание материалов внутри переданной транзакции (tx) — чтобы вызывалось в
  // одной tx со сменой статуса задания: нехватка остатка откатит и завершение (P0-8).
  private async writeOffMaterials(
    tx: Prisma.TransactionClient,
    jobId: string,
    orderId: string,
    userId?: string,
  ) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { service: { include: { materials: true } } } },
      },
    });
    if (!order?.branchId) {
      // Без филиала списывать неоткуда: материалы не спишутся, снимок
      // себестоимости не зафиксируется, а `materialsWrittenOff` останется false.
      // Не молчим — логируем, чтобы расхождение в учёте склада было заметно (P1-116).
      this.logger.warn(
        `writeOffMaterials: заказ ${orderId} без branchId — списание материалов пропущено (job ${jobId})`,
      );
      return;
    }

    const need = new Map<string, number>();
    for (const item of order.items) {
      for (const material of item.service?.materials ?? []) {
        const qty = Number(material.qtyPerUnit) * Number(item.quantity);
        if (qty > 0) {
          need.set(
            material.productId,
            Number(((need.get(material.productId) ?? 0) + qty).toFixed(3)),
          );
        }
      }
    }
    if (need.size === 0) return;

    // Себестоимость материалов на момент списания (снимок для затрат) — P1-2.
    // Берём Product.purchasePrice — та же база, что для оценки склада в отчётах.
    const products = await tx.product.findMany({
      where: { id: { in: [...need.keys()] } },
      select: { id: true, purchasePrice: true },
    });
    const costOf = new Map(
      products.map((p) => [p.id, Number(p.purchasePrice ?? 0)]),
    );

    const claim = await tx.productionJob.updateMany({
      where: { id: jobId, materialsWrittenOff: false, deletedAt: null },
      data: { materialsWrittenOff: true },
    });
    if (claim.count === 0) return;

      for (const [productId, qty] of need) {
        const current = await tx.stock.findUnique({
          where: {
            productId_branchId: { productId, branchId: order.branchId! },
          },
          select: { quantity: true },
        });
        const beforeQty = Number(current?.quantity ?? 0);
        const dec = await tx.stock.updateMany({
          where: {
            productId,
            branchId: order.branchId!,
            product: { companyId: order.companyId, deletedAt: null },
            quantity: { gte: qty },
          },
          data: { quantity: { decrement: qty } },
        });
        if (dec.count === 0) {
          throw new BadRequestException('Not enough material stock');
        }
        const unitCost = costOf.get(productId) ?? 0;
        const totalCost = Number((unitCost * qty).toFixed(4));
        await tx.stockMovement.create({
          data: {
            companyId: order.companyId,
            productId,
            branchId: order.branchId,
            type: StockMovementType.WRITE_OFF,
            quantity: qty,
            beforeQty,
            afterQty: Number((beforeQty - qty).toFixed(3)),
            reason: `Production for order ${order.orderNumber}`,
            orderId: order.id,
            // исполнитель, завершивший задание (для восстановления себестоимости)
            userId: userId ?? null,
            // снимок себестоимости и связь с заданием — P1-2
            unitCost,
            totalCost,
            productionJobId: jobId,
          },
        });
      }

      // Сводный аудит списания материалов производства (P1-9d): детали по
      // позициям — в StockMovement (с себестоимостью, P1-2), здесь — факт и объём.
      await this.audit.recordTx(tx, {
        companyId: order.companyId,
        userId: userId ?? undefined,
        action: 'stock:production-writeoff',
        entity: 'productionJob',
        entityId: jobId,
        after: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          itemsCount: need.size,
          totalCost: Number(
            [...need]
              .reduce((s, [pid, q]) => s + (costOf.get(pid) ?? 0) * q, 0)
              .toFixed(4),
          ),
        },
      });
  }

  // Реверс списания материалов при уходе задания из COMPLETED (отмена/переделка).
  // Без реверса остатки занижены на потреблённый объём, а стоковый леджер
  // расходится с фактическим остатком (P1-97). Идемпотентно: claim через
  // updateMany (materialsWrittenOff true→false) пропускает ровно один реверс на
  // цикл завершения — повторные вызовы и гонки становятся no-op. Возвращаем на
  // склад НЕПОГАШЕННЫЙ объём (списания WRITE_OFF минус прежние реверсы IN этого
  // задания) — корректно при нескольких циклах COMPLETED→REWORK→COMPLETED.
  private async reverseMaterialWriteOff(
    tx: Prisma.TransactionClient,
    job: { id: string; orderId: string; companyId: string },
    userId?: string,
  ) {
    const claim = await tx.productionJob.updateMany({
      where: { id: job.id, materialsWrittenOff: true, deletedAt: null },
      data: { materialsWrittenOff: false },
    });
    if (claim.count === 0) return;

    const movements = await tx.stockMovement.findMany({
      where: { productionJobId: job.id, deletedAt: null },
      select: {
        productId: true,
        branchId: true,
        type: true,
        quantity: true,
        unitCost: true,
      },
    });

    // Аггрегация по товару: списано (WRITE_OFF), уже возвращено (IN — прежние
    // реверсы), суммарная себестоимость списаний (для средневзвешенного снимка).
    const perProduct = new Map<
      string,
      { branchId: string | null; writtenOff: number; reversed: number; cost: number }
    >();
    for (const m of movements) {
      const cur =
        perProduct.get(m.productId) ??
        { branchId: m.branchId, writtenOff: 0, reversed: 0, cost: 0 };
      const q = Number(m.quantity);
      if (m.type === StockMovementType.WRITE_OFF) {
        cur.writtenOff += q;
        cur.cost += Number(m.unitCost ?? 0) * q;
        if (!cur.branchId) cur.branchId = m.branchId;
      } else if (m.type === StockMovementType.IN) {
        cur.reversed += q;
      }
      perProduct.set(m.productId, cur);
    }

    let restoredCount = 0;
    for (const [productId, agg] of perProduct) {
      const netQty = Number((agg.writtenOff - agg.reversed).toFixed(3));
      if (netQty <= 0 || !agg.branchId) continue;
      const branchId = agg.branchId;
      const current = await tx.stock.findUnique({
        where: { productId_branchId: { productId, branchId } },
        select: { quantity: true },
      });
      const beforeQty = Number(current?.quantity ?? 0);
      await tx.stock.upsert({
        where: { productId_branchId: { productId, branchId } },
        create: { productId, branchId, quantity: netQty },
        update: { quantity: { increment: netQty } },
      });
      // Средневзвешенная себестоимость списания — симметричный снимок для реверса.
      const unitCost =
        agg.writtenOff > 0 ? Number((agg.cost / agg.writtenOff).toFixed(4)) : 0;
      // Тип IN: reports.net учитывает IN/RETURN как приход и гасит WRITE_OFF; ADJUST
      // в стоковом отчёте не учитывается, поэтому для реверса он не годится.
      await tx.stockMovement.create({
        data: {
          companyId: job.companyId,
          productId,
          branchId,
          type: StockMovementType.IN,
          quantity: netQty,
          beforeQty,
          afterQty: Number((beforeQty + netQty).toFixed(3)),
          reason: `Reversal of production write-off (job ${job.id})`,
          orderId: job.orderId,
          userId: userId ?? null,
          unitCost,
          totalCost: Number((unitCost * netQty).toFixed(4)),
          productionJobId: job.id,
        },
      });
      restoredCount += 1;
    }

    await this.audit.recordTx(tx, {
      companyId: job.companyId,
      userId: userId ?? undefined,
      action: 'stock:production-writeoff-reverse',
      entity: 'productionJob',
      entityId: job.id,
      after: { orderId: job.orderId, itemsCount: restoredCount },
    });
  }

  async remove(id: string, companyId: string) {
    await this.ensure(id, companyId);
    await this.prisma.productionJob.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async setResultPhoto(id: string, companyId: string, url: string) {
    await this.ensure(id, companyId);
    return this.prisma.productionJob.update({
      where: { id },
      data: { resultPhotoUrl: url },
      include: this.includes(),
    });
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
      where: { id, companyId, deletedAt: null },
    });
    if (!job) throw new NotFoundException('Production job not found');
    return job;
  }

  private async ensureUser(companyId: string, userId?: string) {
    if (!userId) return;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Assigned user not found');
  }

  private async ensureEquipment(companyId: string, equipmentId?: string) {
    if (!equipmentId) return;
    const equipment = await this.prisma.equipment.findFirst({
      where: { id: equipmentId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!equipment) throw new NotFoundException('Equipment not found');
  }

  private async syncOrderStatus(orderId: string) {
    const jobs = await this.prisma.productionJob.findMany({
      where: { orderId, deletedAt: null },
      select: { status: true },
    });
    if (jobs.length === 0) return;

    const active = jobs.filter((job) => job.status !== ProductionStatus.CANCELLED);
    if (active.length === 0) return;

    const allDone = active.every(
      (job) => job.status === ProductionStatus.COMPLETED,
    );
    const anyWorking = active.some(
      (job) =>
        job.status !== ProductionStatus.PENDING &&
        job.status !== ProductionStatus.COMPLETED,
    );

    let next: OrderStatus | null = null;
    if (allDone) next = OrderStatus.READY;
    else if (anyWorking) next = OrderStatus.IN_PROGRESS;

    if (!next) return;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    // Не откатываем терминальные/пост-продакшн статусы: поздний REWORK или
    // пере-завершение job'а не должны возвращать выданный/отменённый заказ в
    // производство (READY/IN_PROGRESS). (P0-9)
    const isTerminal =
      order?.status === OrderStatus.DELIVERED ||
      order?.status === OrderStatus.CANCELLED;
    if (order && order.status !== next && !isTerminal) {
      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: orderId },
          data: { status: next },
        }),
        this.prisma.orderStatusHistory.create({
          data: { orderId, status: next, reason: 'auto production' },
        }),
      ]);
    }
  }
}
