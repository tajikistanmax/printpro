import { Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  Prisma,
  ProductionStatus,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Финансовая сводка за период
  async summary(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);

    // Заказы за период: сколько выставлено, оплачено, осталось должно
    const orders = await this.prisma.order.aggregate({
      where: { companyId, createdAt: range },
      _sum: { total: true, paid: true, balanceDue: true },
      _count: true,
    });

    // Оплаты за период по способам
    const payments = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { companyId, createdAt: range },
      _sum: { amount: true },
    });
    const byMethod: Record<string, number> = {
      CASH: 0,
      CARD: 0,
      TRANSFER: 0,
      DEBT: 0,
    };
    for (const p of payments) {
      byMethod[p.method] = Number(p._sum.amount ?? 0);
    }

    const billed = Number(orders._sum.total ?? 0);
    const ordersCount = orders._count;
    // Реальные деньги (без записей «в долг»)
    const collected = Number(
      (byMethod.CASH + byMethod.CARD + byMethod.TRANSFER).toFixed(2),
    );

    return {
      from: range.gte,
      to: range.lte,
      ordersCount,
      billed, // выставлено по заказам
      collected, // получено деньгами
      debt: Number(orders._sum.balanceDue ?? 0), // остаток долга по заказам периода
      avgCheck: ordersCount
        ? Number((billed / ordersCount).toFixed(2))
        : 0,
      byMethod: {
        cash: byMethod.CASH,
        card: byMethod.CARD,
        transfer: byMethod.TRANSFER,
        debt: byMethod.DEBT,
      },
    };
  }

  // Выручка по дням (для графика)
  async daily(companyId: string, days = 14) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const payments = await this.prisma.payment.findMany({
      where: {
        companyId,
        createdAt: { gte: from, lte: to },
        method: { not: PaymentMethod.DEBT },
      },
      select: { amount: true, createdAt: true },
    });

    // Заготовка дней (чтобы пустые тоже были)
    const map = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      map.set(this.dayKey(d), 0);
    }
    for (const p of payments) {
      const key = this.dayKey(p.createdAt);
      if (map.has(key)) {
        map.set(key, Number((map.get(key)! + Number(p.amount)).toFixed(2)));
      }
    }
    return Array.from(map.entries()).map(([date, amount]) => ({ date, amount }));
  }

  // Продажи по услугам/товарам за период (топ)
  async salesByItem(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);
    const items = await this.prisma.orderItem.findMany({
      where: { order: { companyId, createdAt: range } },
      select: {
        itemType: true,
        quantity: true,
        lineTotal: true,
        description: true,
        service: { select: { name: true } },
        product: { select: { name: true } },
      },
    });

    const agg = new Map<
      string,
      { name: string; type: string; qty: number; revenue: number }
    >();
    for (const it of items) {
      const name =
        it.service?.name ??
        it.product?.name ??
        it.description ??
        'Прочее';
      const key = `${it.itemType}:${name}`;
      const cur = agg.get(key) ?? {
        name,
        type: it.itemType,
        qty: 0,
        revenue: 0,
      };
      cur.qty = Number((cur.qty + Number(it.quantity)).toFixed(3));
      cur.revenue = Number((cur.revenue + Number(it.lineTotal)).toFixed(2));
      agg.set(key, cur);
    }
    return Array.from(agg.values()).sort((a, b) => b.revenue - a.revenue);
  }

  // Прибыль по заказам за период: выручка − себестоимость (п. 2.10 ТЗ)
  // Считаем только по непогашенным/оплаченным заказам, исключая отменённые.
  async profit(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);

    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        createdAt: range,
        status: { not: 'CANCELLED' },
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        total: true,
        client: { select: { fullName: true, phone: true } },
        items: { select: { lineTotal: true, lineCost: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalRevenue = 0;
    let totalCost = 0;
    const list = orders.map((o) => {
      const revenue = o.items.reduce((s, it) => s + Number(it.lineTotal), 0);
      const cost = o.items.reduce((s, it) => s + Number(it.lineCost), 0);
      const profit = Number((revenue - cost).toFixed(2));
      totalRevenue += revenue;
      totalCost += cost;
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        date: o.createdAt,
        client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
        revenue: Number(revenue.toFixed(2)),
        cost: Number(cost.toFixed(2)),
        profit,
        margin: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(1)) : 0,
      };
    });

    totalRevenue = Number(totalRevenue.toFixed(2));
    totalCost = Number(totalCost.toFixed(2));
    const totalProfit = Number((totalRevenue - totalCost).toFixed(2));

    return {
      from: range.gte,
      to: range.lte,
      ordersCount: list.length,
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalProfit,
      margin:
        totalRevenue > 0
          ? Number(((totalProfit / totalRevenue) * 100).toFixed(1))
          : 0,
      items: list,
    };
  }

  // Долги клиентов (заказы с непогашенным остатком)
  async debts(companyId: string) {
    const orders = await this.prisma.order.findMany({
      where: { companyId, balanceDue: { gt: new Prisma.Decimal(0) } },
      include: { client: true },
      orderBy: { createdAt: 'asc' },
    });
    const list = orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
      phone: o.client?.phone ?? '',
      total: Number(o.total),
      paid: Number(o.paid),
      debt: Number(o.balanceDue),
    }));
    const total = Number(
      list.reduce((s, d) => s + d.debt, 0).toFixed(2),
    );
    return { total, count: list.length, items: list };
  }

  // Эффективность сотрудников за период
  async staffPerformance(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);

    const users = await this.prisma.user.findMany({
      where: { companyId },
      select: { id: true, fullName: true, role: { select: { name: true } } },
    });

    // Заказы, созданные сотрудником (в периоде)
    const orders = await this.prisma.order.groupBy({
      by: ['createdById'],
      where: { companyId, createdAt: range, createdById: { not: null } },
      _count: true,
      _sum: { total: true },
    });
    // Выполненные производственные задания (по завершению в периоде)
    const prod = await this.prisma.productionJob.groupBy({
      by: ['assignedUserId'],
      where: {
        companyId,
        status: ProductionStatus.COMPLETED,
        completedAt: range,
        assignedUserId: { not: null },
      },
      _count: true,
    });
    // Выполненные задачи
    const tasks = await this.prisma.task.groupBy({
      by: ['assignedUserId'],
      where: {
        companyId,
        status: TaskStatus.DONE,
        assignedUserId: { not: null },
      },
      _count: true,
    });

    const ordersBy = new Map(
      orders.map((o) => [o.createdById, o]),
    );
    const prodBy = new Map(prod.map((p) => [p.assignedUserId, p._count]));
    const tasksBy = new Map(tasks.map((t) => [t.assignedUserId, t._count]));

    return users
      .map((u) => {
        const o = ordersBy.get(u.id);
        return {
          id: u.id,
          name: u.fullName,
          role: u.role?.name ?? '—',
          ordersCreated: o?._count ?? 0,
          salesSum: Number(o?._sum.total ?? 0),
          productionDone: prodBy.get(u.id) ?? 0,
          tasksDone: tasksBy.get(u.id) ?? 0,
        };
      })
      .sort((a, b) => b.salesSum - a.salesSum);
  }

  // ---------- helpers ----------
  // Диапазон дат: по умолчанию — текущий месяц
  private range(from?: string, to?: string): { gte: Date; lte: Date } {
    let gte: Date;
    let lte: Date;
    if (from) {
      gte = new Date(from);
    } else {
      gte = new Date();
      gte.setDate(1);
    }
    gte.setHours(0, 0, 0, 0);
    lte = to ? new Date(to) : new Date();
    lte.setHours(23, 59, 59, 999);
    return { gte, lte };
  }

  private dayKey(d: Date) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
}
