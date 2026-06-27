import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  // Найти клиента по телефону или создать нового
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

  create(companyId: string, phone: string, fullName?: string, note?: string) {
    return this.findOrCreate(companyId, phone, fullName, note);
  }

  findAll(companyId: string, search?: string) {
    return this.prisma.client.findMany({
      where: {
        companyId,
        ...(search
          ? {
              OR: [
                { phone: { contains: search } },
                { fullName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { orders: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    return client;
  }
}
