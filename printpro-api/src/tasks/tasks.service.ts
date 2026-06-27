import { Injectable, NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTaskDto) {
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

  async updateStatus(id: string, status: TaskStatus) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Задача не найдена');
    return this.prisma.task.update({
      where: { id },
      data: { status },
      include: { assignedUser: { select: { id: true, fullName: true } } },
    });
  }
}
