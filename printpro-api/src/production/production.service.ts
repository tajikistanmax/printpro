import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, ProductionStatus } from '@prisma/client';
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
  ) {
    const job = await this.ensure(id, companyId);

    const data: {
      status: ProductionStatus;
      startedAt?: Date;
      completedAt?: Date | null;
      defectReason?: string | null;
    } = { status };

    // Первый переход из «ожидает» в работу — фиксируем старт
    if (status !== ProductionStatus.PENDING && !job.startedAt) {
      data.startedAt = new Date();
    }
    // Готово — фиксируем завершение, иначе сбрасываем
    data.completedAt = status === ProductionStatus.COMPLETED ? new Date() : null;

    // Брак/переделка — сохраняем причину; иначе очищаем
    data.defectReason =
      status === ProductionStatus.REWORK ? defectReason ?? null : null;

    const updated = await this.prisma.productionJob.update({
      where: { id },
      data,
      include: this.includes(),
    });

    // При завершении — авто-списание материалов со склада (один раз)
    if (status === ProductionStatus.COMPLETED && !job.materialsWrittenOff) {
      await this.writeOffMaterials(job.id, job.orderId);
    }

    // Подтягиваем статус заказа за производством
    await this.syncOrderStatus(job.orderId);

    return updated;
  }

  // Авто-списание материалов по спецификации услуг заказа
  private async writeOffMaterials(jobId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { service: { include: { materials: true } } } },
      },
    });
    if (!order?.branchId) return; // некуда списывать без филиала

    // Сводим расход по товарам: Σ (норма × кол-во услуги)
    const need = new Map<string, number>();
    for (const it of order.items) {
      const mats = it.service?.materials ?? [];
      for (const m of mats) {
        const qty = Number(m.qtyPerUnit) * Number(it.quantity);
        if (qty > 0) need.set(m.productId, (need.get(m.productId) ?? 0) + qty);
      }
    }
    if (need.size === 0) {
      await this.prisma.productionJob.update({
        where: { id: jobId },
        data: { materialsWrittenOff: true },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [productId, qty] of need) {
        await tx.stock.upsert({
          where: { productId_branchId: { productId, branchId: order.branchId! } },
          create: {
            productId,
            branchId: order.branchId!,
            quantity: -qty, // допускаем минус: фиксируем фактический расход
          },
          update: { quantity: { decrement: qty } },
        });
        await tx.stockMovement.create({
          data: {
            companyId: order.companyId,
            productId,
            branchId: order.branchId,
            type: 'WRITE_OFF',
            quantity: qty,
            reason: `Производство по заказу №${order.orderNumber}`,
            orderId: order.id,
          },
        });
      }
      await tx.productionJob.update({
        where: { id: jobId },
        data: { materialsWrittenOff: true },
      });
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
      if (order && order.status !== next) {
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
