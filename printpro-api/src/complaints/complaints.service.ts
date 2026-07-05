import { Injectable, NotFoundException } from '@nestjs/common';
import { ComplaintStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: {
    companyId: string;
    title: string;
    description?: string;
    orderId?: string;
    clientId?: string;
    createdById?: string;
  }) {
    // Ссылки orderId/clientId приходят из тела — проверяем, что они принадлежат
    // компании из токена, иначе рекламацию можно привязать к чужому заказу/клиенту.
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, companyId: dto.companyId },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
    }
    if (dto.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: dto.clientId, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!client) throw new NotFoundException('Клиент не найден');
    }
    return this.prisma.complaint.create({
      data: {
        companyId: dto.companyId,
        title: dto.title,
        description: dto.description,
        orderId: dto.orderId,
        clientId: dto.clientId,
        createdById: dto.createdById,
      },
      include: this.includes(),
    });
  }

  findAll(companyId: string, status?: ComplaintStatus) {
    return this.prisma.complaint.findMany({
      where: { companyId, deletedAt: null, ...(status ? { status } : {}) },
      include: this.includes(),
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async updateStatus(
    id: string,
    companyId: string,
    status: ComplaintStatus,
    resolution?: string,
  ) {
    const c = await this.prisma.complaint.findFirst({
      where: { id, companyId },
    });
    if (!c) throw new NotFoundException('Рекламация не найдена');
    return this.prisma.complaint.update({
      where: { id },
      data: {
        status,
        ...(resolution !== undefined ? { resolution } : {}),
      },
      include: this.includes(),
    });
  }

  async remove(id: string, companyId: string) {
    const c = await this.prisma.complaint.findFirst({
      where: { id, companyId },
    });
    if (!c) throw new NotFoundException('Рекламация не найдена');
    await this.prisma.complaint.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private includes() {
    return {
      order: { select: { id: true, orderNumber: true } },
      client: { select: { id: true, fullName: true, phone: true } },
    };
  }
}
