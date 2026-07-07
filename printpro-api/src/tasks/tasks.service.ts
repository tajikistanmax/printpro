import { Injectable, NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTaskDto) {
    // orderId/assignedUserId приходят из тела запроса — проверяем, что они
    // принадлежат компании из токена, иначе задачу можно привязать к чужому
    // заказу или назначить чужому сотруднику (cross-tenant IDOR).
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, companyId: dto.companyId },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
    }
    if (dto.assignedUserId) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: dto.assignedUserId, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!assignee) throw new NotFoundException('Сотрудник не найден');
    }
    return this.prisma.task.create({
      data: {
        companyId: dto.companyId,
        title: dto.title,
        description: dto.description,
        clientPhone: dto.clientPhone,
        orderId: dto.orderId,
        assignedUserId: dto.assignedUserId,
        createdById: dto.createdById,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        priority: dto.priority ?? 0,
      },
      include: { assignedUser: { select: { id: true, fullName: true } } },
    });
  }

  // Список с фильтрами: по исполнителю и статусу
  findAll(companyId: string, assignedUserId?: string, status?: TaskStatus) {
    return this.prisma.task.findMany({
      where: {
        companyId,
        ...(assignedUserId ? { assignedUserId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        assignedUser: { select: { id: true, fullName: true } },
        order: { select: { id: true, orderNumber: true } },
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async updateStatus(id: string, status: TaskStatus, companyId: string) {
    const task = await this.prisma.task.findFirst({ where: { id, companyId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    return this.prisma.task.update({
      where: { id },
      data: { status },
      include: { assignedUser: { select: { id: true, fullName: true } } },
    });
  }
}
