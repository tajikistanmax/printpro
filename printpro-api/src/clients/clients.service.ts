import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  // Найти клиента по телефону или создать нового (используется при заказе)
  async findOrCreate(
    companyId: string,
    phone: string,
    fullName?: string,
    note?: string,
  ) {
    const existing = await this.prisma.client.findFirst({
      where: { companyId, phone },
    });
    if (existing) return existing;
    return this.prisma.client.create({
      data: { companyId, phone, fullName, note },
    });
  }

  // Полное создание из карточки клиента
  create(dto: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        companyId: dto.companyId,
        phone: dto.phone,
        fullName: dto.fullName,
        type: dto.type,
        email: dto.email,
        address: dto.address,
        inn: dto.inn,
        discount: dto.discount ?? 0,
        note: dto.note,
      },
    });
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.ensure(id);
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  async findAll(companyId: string, search?: string, page = 1, pageSize = 25) {
    const where: Prisma.ClientWhereInput = {
      companyId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { phone: { contains: search } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.client.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), pageSize: take };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderNumber: true,
            total: true,
            paid: true,
            balanceDue: true,
            status: true,
            createdAt: true,
          },
        },
        files: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    // Итоги: всего заказов, потрачено, общий долг
    const totalSpent = client.orders.reduce(
      (s, o) => s + Number(o.paid),
      0,
    );
    const totalDebt = client.orders.reduce(
      (s, o) => s + Number(o.balanceDue),
      0,
    );

    return {
      ...client,
      discount: Number(client.discount),
      stats: {
        ordersCount: client.orders.length,
        totalSpent: Number(totalSpent.toFixed(2)),
        totalDebt: Number(totalDebt.toFixed(2)),
      },
    };
  }

  // ---------- Файлы клиента ----------
  async addFile(
    clientId: string,
    fileUrl: string,
    fileName?: string,
    type?: string,
  ) {
    await this.ensure(clientId);
    return this.prisma.clientFile.create({
      data: { clientId, fileUrl, fileName, type },
    });
  }

  async removeFile(fileId: string) {
    await this.prisma.clientFile.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private async ensure(id: string) {
    const c = await this.prisma.client.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Клиент не найден');
    return c;
  }
}
