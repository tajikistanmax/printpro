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
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    return this.prisma.productionJob.create({
      data: {
        companyId: dto.companyId,
        orderId: dto.orderId,
        assignedUserId: dto.assignedUserId,
        printer: dto.printer,
        priority: dto.priority ?? 0,
        note: dto.note,
      },
      include: this.includes(),
    });
  }

  // Список заданий (доска производства), фильтр по статусу
  findAll(companyId: string, status?: ProductionStatus) {
    return this.prisma.productionJob.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: this.includes(),
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // Обновить назначение/принтер/приоритет/заметку
  async update(id: string, dto: UpdateProductionJobDto) {
    await this.ensure(id);
    return this.prisma.productionJob.update({
      where: { id },
      data: {
        assignedUserId: dto.assignedUserId,
        printer: dto.printer,
        priority: dto.priority,
        note: dto.note,
      },
      include: this.includes(),
    });
  }

  // Сменить статус + синхронизировать статус заказа
  async updateStatus(id: string, status: ProductionStatus) {
    const job = await this.ensure(id);

    const data: {
      status: ProductionStatus;
      startedAt?: Date;
      completedAt?: Date | null;
    } = { status };

    // Первый переход из «ожидает» в работу — фиксируем старт
    if (status !== ProductionStatus.PENDING && !job.startedAt) {
      data.startedAt = new Date();
    }
    // Готово — фиксируем завершение, иначе сбрасываем
    data.completedAt = status === ProductionStatus.COMPLETED ? new Date() : null;

    const updated = await this.prisma.productionJob.update({
      where: { id },
      data,
      include: this.includes(),
    });

    // Подтягиваем статус заказа за производством
    await this.syncOrderStatus(job.orderId);

    return updated;
  }

  async remove(id: string) {
    await this.ensure(id);
    await this.prisma.productionJob.delete({ where: { id } });
    return { ok: true };
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
    };
  }

  private async ensure(id: string) {
    const job = await this.prisma.productionJob.findUnique({ where: { id } });
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
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: next },
      });
    }
  }
}
