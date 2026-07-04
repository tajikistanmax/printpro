import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  Prisma,
  ProductionStatus,
  StockMovementType,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Финансовая сводка за период
  async summary(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);

    // Заказы за период: сколько выставлено, оплачено, осталось должно.
    // Отменённые исключаем — иначе завышаем выставленное/кол-во/долг.
    const orders = await this.prisma.order.aggregate({
      where: {
        companyId,
        createdAt: range,
        status: { not: 'CANCELLED' },
        deletedAt: null,
      },
      _sum: { total: true, paid: true, balanceDue: true, returnedTotal: true },
      _count: true,
    });

    // Оплаты за период по способам (возвраты — отрицательные Payment,
    // поэтому суммы уже нетто; мягко удалённые исключаем)
    const payments = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { companyId, createdAt: range, deletedAt: null },
      _sum: { amount: true },
    });
    const byMethod: Record<string, number> = {
      CASH: 0,
      CARD: 0,
      QR: 0,
      TRANSFER: 0,
      DEBT: 0,
    };
    for (const p of payments) {
      byMethod[p.method] = Number(p._sum.amount ?? 0);
    }

    const billed = Number(orders._sum.total ?? 0);
    const returns = Number(orders._sum.returnedTotal ?? 0); // возвраты (контр-выручка)
    const net = Number((billed - returns).toFixed(2)); // чистая выручка
    const ordersCount = orders._count;
    // Реальные деньги (без записей «в долг»)
    const collected = Number(
      (byMethod.CASH + byMethod.CARD + byMethod.QR + byMethod.TRANSFER).toFixed(2),
    );

    return {
      from: range.gte,
      to: range.lte,
      ordersCount,
      billed, // выставлено по заказам (валовое)
      returns, // возвраты за период
      net, // чистая выручка = выставлено − возвраты
      collected, // получено деньгами
      debt: Number(orders._sum.balanceDue ?? 0), // остаток долга по заказам периода
      // Средний чек — по чистой выручке (после возвратов), а не по валовой.
      avgCheck: ordersCount ? Number((net / ordersCount).toFixed(2)) : 0,
      byMethod: {
        cash: byMethod.CASH,
        card: byMethod.CARD,
        qr: byMethod.QR,
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
        deletedAt: null,
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
      where: {
        order: {
          companyId,
          createdAt: range,
          status: { not: 'CANCELLED' },
          deletedAt: null,
        },
      },
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
        deletedAt: null,
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        total: true,
        returnedTotal: true,
        returnedCost: true,
        client: { select: { fullName: true, phone: true } },
        items: { select: { lineTotal: true, lineCost: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalRevenue = 0;
    let totalCost = 0;
    const list = orders.map((o) => {
      // Выручку берём из итога заказа (o.total) — он уже учитывает скидку/промокод/
      // бонусы, в отличие от суммы позиций. Иначе прибыль завышалась бы на размер
      // скидки и расходилась со сводкой (там тоже o.total). Минус возвращённое.
      const revenue = Number(o.total) - Number(o.returnedTotal);
      const cost =
        o.items.reduce((s, it) => s + Number(it.lineCost), 0) - Number(o.returnedCost);
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

  // Расходы кассы по категориям за период (тип OUT)
  async expenses(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);
    // Возвраты не показываем как расход: это контр-выручка (учтена в «net»),
    // иначе она бы вычиталась дважды.
    const movements = await this.prisma.cashMovement.findMany({
      where: {
        companyId,
        type: 'OUT',
        createdAt: range,
        NOT: { category: 'Возвраты' },
      },
      select: { amount: true, category: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const byCat = new Map<string, number>();
    let total = 0;
    for (const m of movements) {
      const cat = m.category?.trim() || 'Без категории';
      const amt = Number(m.amount);
      byCat.set(cat, Number(((byCat.get(cat) ?? 0) + amt).toFixed(2)));
      total += amt;
    }

    return {
      from: range.gte,
      to: range.lte,
      total: Number(total.toFixed(2)),
      byCategory: Array.from(byCat.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      items: movements.map((m) => ({
        date: m.createdAt,
        category: m.category?.trim() || 'Без категории',
        reason: m.reason ?? '',
        amount: Number(m.amount),
      })),
    };
  }

  // Загрузка оборудования: задания по станкам и статусам (п. 2.2/2.10)
  async equipmentLoad(companyId: string) {
    const equipment = await this.prisma.equipment.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, type: true, status: true },
      orderBy: { name: 'asc' },
    });

    const jobs = await this.prisma.productionJob.groupBy({
      by: ['equipmentId', 'status'],
      where: { companyId, deletedAt: null, equipmentId: { not: null } },
      _count: true,
    });

    const byEq = new Map<string, Record<string, number>>();
    for (const j of jobs) {
      const key = j.equipmentId as string;
      const row = byEq.get(key) ?? {};
      row[j.status] = j._count;
      byEq.set(key, row);
    }

    const active = (r: Record<string, number>) =>
      (r.PENDING ?? 0) +
      (r.PRINTING ?? 0) +
      (r.CUTTING ?? 0) +
      (r.BINDING ?? 0) +
      (r.PACKAGING ?? 0) +
      (r.REWORK ?? 0);

    return equipment.map((e) => {
      const r = byEq.get(e.id) ?? {};
      return {
        id: e.id,
        name: e.name,
        type: e.type ?? '—',
        status: e.status,
        inQueue: r.PENDING ?? 0,
        inWork: active(r) - (r.PENDING ?? 0),
        active: active(r),
        completed: r.COMPLETED ?? 0,
        rework: r.REWORK ?? 0,
        total: Object.values(r).reduce((s, n) => s + n, 0),
      };
    });
  }

  // Долги клиентов (заказы с непогашенным остатком).
  // Отменённые исключаем — их остаток не является реальным долгом.
  async debts(companyId: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        status: { not: 'CANCELLED' },
        deletedAt: null,
        balanceDue: { gt: new Prisma.Decimal(0) },
      },
      include: { client: true },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    const list = orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
      phone: o.client?.phone ?? '',
      total: Number(o.total),
      paid: Number(o.paid),
      debt: Number(o.balanceDue),
      dueDate: o.debtDueDate,
      // Просрочка — только если срок задан и уже прошёл.
      overdue: o.debtDueDate ? new Date(o.debtDueDate).getTime() < now : false,
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
      where: {
        companyId,
        createdAt: range,
        createdById: { not: null },
        status: { not: 'CANCELLED' },
        deletedAt: null,
      },
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

  // Расход материалов за период (OUT + списания), по товарам (п. 2.10 ТЗ)
  async materialsUsage(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);
    const moves = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'type'],
      where: {
        companyId,
        createdAt: range,
        type: { in: [StockMovementType.OUT, StockMovementType.WRITE_OFF] },
      },
      _sum: { quantity: true },
    });
    const ids = [...new Set(moves.map((m) => m.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        purchasePrice: true,
        unit: { select: { shortName: true } },
      },
    });
    const pmap = new Map(products.map((p) => [p.id, p]));
    const agg = new Map<
      string,
      { name: string; unit: string; used: number; writeOff: number; cost: number }
    >();
    for (const m of moves) {
      const p = pmap.get(m.productId);
      const cur = agg.get(m.productId) ?? {
        name: p?.name ?? '—',
        unit: p?.unit?.shortName ?? '',
        used: 0,
        writeOff: 0,
        cost: 0,
      };
      const qty = Number(m._sum.quantity ?? 0);
      if (m.type === StockMovementType.WRITE_OFF) cur.writeOff += qty;
      else cur.used += qty;
      cur.cost += qty * Number(p?.purchasePrice ?? 0);
      agg.set(m.productId, cur);
    }
    const items = [...agg.entries()]
      .map(([productId, x]) => ({
        productId,
        name: x.name,
        unit: x.unit,
        used: Number(x.used.toFixed(3)),
        writeOff: Number(x.writeOff.toFixed(3)),
        total: Number((x.used + x.writeOff).toFixed(3)),
        cost: Number(x.cost.toFixed(2)),
      }))
      .sort((a, b) => b.cost - a.cost);
    return {
      from: range.gte,
      to: range.lte,
      totalCost: Number(items.reduce((s, i) => s + i.cost, 0).toFixed(2)),
      items,
    };
  }

  // Заказы по статусам за период (сколько и на какую сумму)
  async ordersByStatus(companyId: string, from?: string, to?: string) {
    const range = this.range(from, to);
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { companyId, createdAt: range, deletedAt: null },
      _count: true,
      _sum: { total: true },
    });
    return rows
      .map((r) => ({
        status: r.status,
        count: r._count,
        total: Number(r._sum.total ?? 0),
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Просроченные заказы: срок прошёл, но заказ не выдан и не отменён
  async overdueOrders(companyId: string) {
    const now = new Date();
    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        deletedAt: null,
        deadline: { lt: now },
        status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] },
      },
      include: {
        client: { select: { fullName: true, phone: true } },
        assignedUser: { select: { fullName: true } },
      },
      orderBy: { deadline: 'asc' },
      take: 200,
    });
    return orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
      status: o.status,
      deadline: o.deadline,
      manager: o.assignedUser?.fullName ?? '',
      total: Number(o.total),
      balanceDue: Number(o.balanceDue),
    }));
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
