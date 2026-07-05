import { Injectable, NotFoundException } from '@nestjs/common';
import { ClientType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

export interface ClientFilters {
  search?: string;
  type?: ClientType;
  status?: 'active' | 'inactive';
  page?: number;
  pageSize?: number;
}

const INACTIVE_MS = 30 * 24 * 3600 * 1000;

// Единый вид телефона: убираем пробелы, скобки, дефисы (сохраняя «+»), чтобы
// «+992 93-555-55-55» и «+992935555555» не создавали двух разных клиентов.
function normalizePhone(phone: string): string {
  return (phone ?? '').replace(/[\s()\-]/g, '');
}

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
    const norm = normalizePhone(phone);
    // Ищем существующего ТОЛЬКО при непустом телефоне: иначе findFirst по phone=''
    // привязал бы walk-in к произвольному клиенту без телефона (medium).
    if (norm) {
      const existing = await this.prisma.client.findFirst({
        where: { companyId, phone: norm, deletedAt: null },
      });
      if (existing) return existing;
    }
    return this.prisma.client.create({
      data: { companyId, phone: norm, fullName, note },
    });
  }

  // Полное создание из карточки клиента
  create(dto: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        companyId: dto.companyId,
        phone: normalizePhone(dto.phone),
        fullName: dto.fullName,
        type: dto.type,
        email: dto.email,
        address: dto.address,
        inn: dto.inn,
        discount: dto.discount ?? 0,
        creditLimit: dto.creditLimit ?? 0,
        note: dto.note,
      },
    });
  }

  async update(id: string, dto: UpdateClientDto, companyId: string) {
    await this.ensure(id, companyId);
    // Нормализуем телефон при обновлении — иначе он сохранится «как есть», и
    // последующий findOrCreate (который нормализует) не найдёт клиента и создаст
    // дубль (medium: update хранил телефон без нормализации).
    const data: Prisma.ClientUpdateInput = { ...dto };
    if (dto.phone !== undefined) data.phone = normalizePhone(dto.phone);
    return this.prisma.client.update({ where: { id }, data });
  }

  async findAll(companyId: string, f: ClientFilters = {}) {
    const cutoff = new Date(Date.now() - INACTIVE_MS);
    const where: Prisma.ClientWhereInput = {
      companyId,
      deletedAt: null,
      ...(f.type ? { type: f.type } : {}),
      ...(f.status === 'active'
        ? { orders: { some: { createdAt: { gte: cutoff } } } }
        : {}),
      ...(f.status === 'inactive'
        ? { NOT: { orders: { some: { createdAt: { gte: cutoff } } } } }
        : {}),
      ...(f.search
        ? {
            OR: [
              { phone: { contains: f.search } },
              { fullName: { contains: f.search, mode: 'insensitive' } },
              { email: { contains: f.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const take = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
    const page = Math.max(f.page ?? 1, 1);
    const skip = (page - 1) * take;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.client.count({ where }),
    ]);

    // Агрегаты по заказам для клиентов текущей страницы
    const ids = items.map((c) => c.id);
    const agg = ids.length
      ? await this.prisma.order.groupBy({
          by: ['clientId'],
          where: { clientId: { in: ids } },
          _sum: { total: true },
          _max: { createdAt: true },
          _count: true,
          orderBy: { clientId: 'asc' },
        })
      : [];
    const map = new Map(agg.map((a) => [a.clientId, a]));

    const withStats = items.map((c) => {
      const a = map.get(c.id);
      const last = a?._max.createdAt ?? null;
      return {
        ...c,
        discount: Number(c.discount),
        creditLimit: Number(c.creditLimit),
        bonusPoints: Number(c.bonusPoints),
        ordersCount: a?._count ?? 0,
        ordersSum: Number(a?._sum.total ?? 0),
        lastOrderAt: last,
        inactive: last ? Date.now() - new Date(last).getTime() > INACTIVE_MS : true,
      };
    });

    return { items: withStats, total, page, pageSize: take };
  }

  // Сводка для карточек на странице «Клиенты»
  async stats(companyId: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const cutoff = new Date(Date.now() - INACTIVE_MS);
    const [total, newThisMonth, active, revenueAgg] = await Promise.all([
      this.prisma.client.count({ where: { companyId, deletedAt: null } }),
      this.prisma.client.count({
        where: { companyId, deletedAt: null, createdAt: { gte: monthStart } },
      }),
      this.prisma.client.count({
        where: {
          companyId,
          deletedAt: null,
          orders: { some: { createdAt: { gte: cutoff } } },
        },
      }),
      this.prisma.order.aggregate({
        where: { companyId, clientId: { not: null } },
        _sum: { total: true },
      }),
    ]);
    return {
      total,
      newThisMonth,
      active,
      revenue: Number(revenueAgg._sum.total ?? 0),
    };
  }

  async findOne(id: string, companyId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, companyId, deletedAt: null },
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

    // Итоги считаем по ВСЕМ заказам клиента (агрегатом), а не по обрезанному
    // take:50 списку — иначе у активного клиента (>50 заказов) долг занижен, а
    // доступный кредит завышен, и персонал выдаст кредит сверх лимита (P0-11).
    // Долг — без отменённых заказов.
    const [spentAgg, debtAgg] = await Promise.all([
      this.prisma.order.aggregate({
        where: { companyId, clientId: id, deletedAt: null },
        _sum: { paid: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: {
          companyId,
          clientId: id,
          deletedAt: null,
          status: { not: OrderStatus.CANCELLED },
        },
        _sum: { balanceDue: true },
      }),
    ]);
    const totalSpent = Number(spentAgg._sum.paid ?? 0);
    const totalDebt = Number(debtAgg._sum.balanceDue ?? 0);
    const ordersCount = spentAgg._count;
    const lastOrderAt = client.orders[0]?.createdAt ?? null;
    // Неактивный — без заказов более 30 дней (п. 8.3 ТЗ)
    const inactive = lastOrderAt
      ? Date.now() - new Date(lastOrderAt).getTime() > 30 * 24 * 3600 * 1000
      : true;
    // Средний чек и LTV (п. 8.5)
    const avgCheck = ordersCount
      ? Number((totalSpent / ordersCount).toFixed(2))
      : 0;

    return {
      ...client,
      discount: Number(client.discount),
      creditLimit: Number(client.creditLimit),
      bonusPoints: Number(client.bonusPoints),
      stats: {
        ordersCount,
        totalSpent: Number(totalSpent.toFixed(2)),
        totalDebt: Number(totalDebt.toFixed(2)),
        avgCheck,
        lastOrderAt,
        inactive,
        creditAvailable:
          Number(client.creditLimit) > 0
            ? Number((Number(client.creditLimit) - totalDebt).toFixed(2))
            : null,
      },
    };
  }

  // ---------- Файлы клиента ----------
  async addFile(
    clientId: string,
    fileUrl: string,
    companyId: string,
    fileName?: string,
    type?: string,
  ) {
    await this.ensure(clientId, companyId);
    return this.prisma.clientFile.create({
      data: { clientId, fileUrl, fileName, type },
    });
  }

  async removeFile(fileId: string, companyId: string) {
    // Проверяем принадлежность файла компании через родительского клиента
    const file = await this.prisma.clientFile.findFirst({
      where: { id: fileId, client: { companyId } },
    });
    if (!file) throw new NotFoundException('Файл не найден');
    await this.prisma.clientFile.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private async ensure(id: string, companyId: string) {
    const c = await this.prisma.client.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Клиент не найден');
    return c;
  }
}
