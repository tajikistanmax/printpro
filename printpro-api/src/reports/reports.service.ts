import { BadRequestException, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  OrderType,
  OrderUrgency,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductionStatus,
  StockMovementType,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private parseEnumValue<T extends Record<string, string>>(
    label: string,
    value: string | undefined,
    enumType: T,
  ): T[keyof T] | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    if (
      (Object.values(enumType) as string[]).includes(normalized)
    ) {
      return normalized as T[keyof T];
    }
    throw new BadRequestException(`Некорректное значение параметра ${label}`);
  }

  // ======================================================================
  // 1) Финансовая сводка за период
  // ======================================================================
  async summary(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    compare?: boolean,
  ) {
    const range = this.range(from, to);
    const core = await this.summaryCore(companyId, range, branchId);

    let compareBlock: Record<string, any> | undefined;
    if (compare) {
      // Предыдущий период той же длины — сразу перед from
      const prevRange = this.prevRange(range);
      const prev = await this.summaryCore(companyId, prevRange, branchId);
      compareBlock = {
        collected: prev.collected,
        billed: prev.billed,
        net: prev.net,
        grossProfit: prev.grossProfit,
        ordersCount: prev.ordersCount,
        avgCheck: prev.avgCheck,
        deltas: {
          collectedPct: this.pctDelta(core.collected, prev.collected),
          billedPct: this.pctDelta(core.billed, prev.billed),
          netPct: this.pctDelta(core.net, prev.net),
          grossProfitPct: this.pctDelta(core.grossProfit, prev.grossProfit),
          ordersCountPct: this.pctDelta(core.ordersCount, prev.ordersCount),
          avgCheckPct: this.pctDelta(core.avgCheck, prev.avgCheck),
        },
      };
    }

    return {
      from: range.gte,
      to: range.lte,
      ordersCount: core.ordersCount,
      billed: core.billed, // выставлено по заказам (валовое), status != CANCELLED
      returns: core.returns, // возвраты за период
      net: core.net, // чистая выручка = выставлено − возвраты
      collected: core.collected, // получено деньгами (без DEBT)
      debt: core.debt, // остаток долга по заказам периода
      avgCheck: core.avgCheck,
      expensesTotal: core.expensesTotal,
      grossProfit: core.grossProfit,
      margin: core.margin,
      newClients: core.newClients,
      byMethod: core.byMethod,
      // доп. индикаторы
      cashCollectionRate: core.cashCollectionRate,
      debtGrowth: core.debtGrowth,
      zeroCostShare: core.zeroCostShare,
      openShiftsCount: core.openShiftsCount,
      ...(compareBlock ? { compare: compareBlock } : {}),
    };
  }

  // Внутреннее ядро сводки (для основного и сравнительного периода)
  private async summaryCore(
    companyId: string,
    range: { gte: Date; lte: Date },
    branchId?: string,
  ) {
    // Заказы за период, кроме отменённых (товарно-выручочные метрики)
    const orderWhere: Prisma.OrderWhereInput = {
      companyId,
      createdAt: range,
      status: { not: 'CANCELLED' },
      ...(branchId ? { branchId } : {}),
    };

    const orders = await this.prisma.order.aggregate({
      where: orderWhere,
      _sum: {
        total: true,
        paid: true,
        balanceDue: true,
        returnedTotal: true,
        returnedCost: true,
      },
      _count: true,
    });

    // Валовая прибыль: (lineTotal − returnedTotal) − (lineCost − returnedCost)
    const itemAgg = await this.prisma.orderItem.aggregate({
      where: { order: orderWhere },
      _sum: { lineTotal: true, lineCost: true },
    });
    // Позиции с нулевой себестоимостью — для zeroCostShare
    const zeroCostItems = await this.prisma.orderItem.aggregate({
      where: {
        order: orderWhere,
        lineCost: { lte: new Prisma.Decimal(0) },
        lineTotal: { gt: new Prisma.Decimal(0) },
      },
      _sum: { lineTotal: true },
    });

    const billed = this.round2(Number(orders._sum.total ?? 0));
    const returns = this.round2(Number(orders._sum.returnedTotal ?? 0));
    const returnedCost = Number(orders._sum.returnedCost ?? 0);
    const net = this.round2(billed - returns);
    const ordersCount = orders._count;
    // Собрано деньгами именно по заказам ПЕРИОДА (order.paid, без DEBT) — та же
    // когорта, что billed/net/debt. Используем для cashCollectionRate/debtGrowth,
    // чтобы не смешивать с кассовыми платежами периода (гасящими долги прошлых
    // периодов), из-за чего rate мог превышать 100% (medium).
    const cohortCollected = this.round2(Number(orders._sum.paid ?? 0));

    const grossRevenue = Number(itemAgg._sum.lineTotal ?? 0) - returns;
    const grossCost = Number(itemAgg._sum.lineCost ?? 0) - returnedCost;
    const grossProfit = this.round2(grossRevenue - grossCost);

    // Оплаты за период по способам (по order.branchId при фильтре)
    const byMethod = await this.paymentsByMethod(companyId, range, branchId);
    const collected = this.round2(
      byMethod.CASH + byMethod.CARD + byMethod.QR + byMethod.TRANSFER,
    );

    // Расходы (CashMovement OUT, кроме «Возвраты»), через shift.branch при фильтре
    const expensesTotal = await this.expensesTotal(companyId, range, branchId);

    // Новые клиенты за период (клиент не привязан к филиалу — фильтр только по компании)
    const newClients = await this.prisma.client.count({
      where: { companyId, createdAt: range },
    });

    // Незакрытые смены за период
    const openShiftsCount = await this.prisma.cashShift.count({
      where: {
        companyId,
        openedAt: range,
        closedAt: null,
        ...(branchId ? { branchId } : {}),
      },
    });

    const zeroCostRevenue = Number(zeroCostItems._sum.lineTotal ?? 0);

    return {
      ordersCount,
      billed,
      returns,
      net,
      collected,
      debt: this.round2(Number(orders._sum.balanceDue ?? 0)),
      avgCheck: ordersCount ? this.round2(billed / ordersCount) : 0,
      expensesTotal,
      grossProfit,
      // Маржа = валовая прибыль / та же item-based база выручки (Σ lineTotal −
      // returns), что и в числителе grossProfit — иначе делили бы на order.total-
      // base net и расходились бы с /profit при любых скидках (P0-25).
      margin: grossRevenue > 0 ? this.round1((grossProfit / grossRevenue) * 100) : 0,
      newClients,
      byMethod: {
        cash: byMethod.CASH,
        card: byMethod.CARD,
        qr: byMethod.QR,
        transfer: byMethod.TRANSFER,
        debt: byMethod.DEBT,
      },
      // Коэффициент сбора и прирост долга — по когорте заказов периода
      // (cohortCollected = Σ order.paid), а не по кассовым платежам периода.
      // Поле collected выше остаётся отдельной кассовой метрикой (получено
      // деньгами за период, feed для byMethod/cashflow).
      cashCollectionRate:
        net > 0 ? this.round1((cohortCollected / net) * 100) : 0,
      debtGrowth: this.round2(net - cohortCollected),
      // Доля выручки без себестоимости — от той же item-based базы (P0-25).
      zeroCostShare:
        grossRevenue > 0 ? this.round1((zeroCostRevenue / grossRevenue) * 100) : 0,
      openShiftsCount,
    };
  }

  // ======================================================================
  // 2) Временной ряд (для графиков)
  // ======================================================================
  async timeseries(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    const range = this.range(from, to);

    // Заказы периода (не отменённые)
    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        createdAt: range,
        status: { not: 'CANCELLED' },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        createdAt: true,
        total: true,
        returnedTotal: true,
        returnedCost: true,
        items: { select: { lineTotal: true, lineCost: true } },
      },
    });

    // Оплаты периода (без DEBT), с учётом филиала через order.branchId
    const payments = await this.prisma.payment.findMany({
      where: {
        companyId,
        createdAt: range,
        method: { not: PaymentMethod.DEBT },
        ...(branchId ? { order: { branchId } } : {}),
      },
      select: { amount: true, createdAt: true },
    });

    const buckets = this.buildBuckets(range, groupBy);
    const idx = new Map(buckets.map((b, i) => [b.key, i]));

    for (const o of orders) {
      const key = this.bucketKey(o.createdAt, groupBy);
      const i = idx.get(key);
      if (i === undefined) continue;
      const b = buckets[i];
      const total = Number(o.total);
      const ret = Number(o.returnedTotal);
      const lineTotal = o.items.reduce((s, it) => s + Number(it.lineTotal), 0);
      const lineCost = o.items.reduce((s, it) => s + Number(it.lineCost), 0);
      b.billed += total;
      b.ordersCount += 1;
      b.profit += lineTotal - ret - (lineCost - Number(o.returnedCost));
    }
    for (const p of payments) {
      const key = this.bucketKey(p.createdAt, groupBy);
      const i = idx.get(key);
      if (i === undefined) continue;
      buckets[i].collected += Number(p.amount);
    }

    let cumCollected = 0;
    const out = buckets.map((b) => {
      cumCollected += b.collected;
      return {
        date: b.key,
        label: b.label,
        collected: this.round2(b.collected),
        billed: this.round2(b.billed),
        ordersCount: b.ordersCount,
        profit: this.round2(b.profit),
        debt: this.round2(b.billed - b.collected),
        avgCheck: b.ordersCount ? this.round2(b.billed / b.ordersCount) : 0,
        cumCollected: this.round2(cumCollected),
      };
    });

    return { groupBy, buckets: out };
  }

  // ======================================================================
  // 3) Выручка по дням (БЕЗ ИЗМЕНЕНИЙ — обратная совместимость)
  // ======================================================================
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
    return Array.from(map.entries()).map(([date, amount]) => ({
      date,
      amount,
    }));
  }

  // ======================================================================
  // 4) Продажи по услугам/товарам за период (топ)
  // ======================================================================
  async salesByItem(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    type: 'SERVICE' | 'PRODUCT' | 'all' = 'all',
    categoryId?: string,
  ) {
    const range = this.range(from, to);
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          companyId,
          createdAt: range,
          status: { not: 'CANCELLED' },
          ...(branchId ? { branchId } : {}),
        },
        ...(type !== 'all' ? { itemType: type } : {}),
      },
      select: {
        orderId: true,
        itemType: true,
        serviceId: true,
        productId: true,
        quantity: true,
        lineTotal: true,
        lineCost: true,
        description: true,
        service: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true, parentId: true } },
          },
        },
        product: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true, parentId: true } },
          },
        },
      },
    });

    type Row = {
      key: string;
      name: string;
      type: string;
      category: string;
      categoryId: string | null;
      parentCategoryId: string | null;
      qty: number;
      revenue: number;
      cost: number;
      orderIds: Set<string>;
    };
    const agg = new Map<string, Row>();
    for (const it of items) {
      // Фильтр по категории (сама категория ИЛИ её родитель)
      const catId = it.service?.categoryId ?? it.product?.categoryId ?? null;
      const parentId =
        it.service?.category?.parentId ??
        it.product?.category?.parentId ??
        null;
      if (categoryId && catId !== categoryId && parentId !== categoryId) {
        continue;
      }

      const name =
        it.service?.name ?? it.product?.name ?? it.description ?? 'Прочее';
      // Ключ агрегации: по serviceId/productId, для строк без ссылки — по описанию
      const key = it.serviceId
        ? `S:${it.serviceId}`
        : it.productId
          ? `P:${it.productId}`
          : `desc:${name}`;
      const category =
        it.service?.category?.name ??
        it.product?.category?.name ??
        'Без категории';
      const cur = agg.get(key) ?? {
        key,
        name,
        type: it.itemType,
        category,
        categoryId: catId,
        parentCategoryId: parentId,
        qty: 0,
        revenue: 0,
        cost: 0,
        orderIds: new Set<string>(),
      };
      cur.qty += Number(it.quantity);
      cur.revenue += Number(it.lineTotal);
      cur.cost += Number(it.lineCost);
      cur.orderIds.add(it.orderId);
      agg.set(key, cur);
    }

    const rows = Array.from(agg.values());
    const total = rows.reduce((s, r) => s + r.revenue, 0);

    return rows
      .map((r) => {
        const revenue = this.round2(r.revenue);
        const cost = this.round2(r.cost);
        const profit = this.round2(revenue - cost);
        const qty = this.round3(r.qty);
        return {
          key: r.key,
          name: r.name,
          type: r.type,
          category: r.category,
          qty,
          revenue,
          cost,
          profit,
          margin: revenue > 0 ? this.round1((profit / revenue) * 100) : 0,
          sharePct: total > 0 ? this.round1((revenue / total) * 100) : 0,
          orders: r.orderIds.size,
          avgPrice: qty > 0 ? this.round2(revenue / qty) : 0,
          avgCost: qty > 0 ? this.round2(cost / qty) : 0,
          zeroCost: cost <= 0 && revenue > 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }

  // ======================================================================
  // 5) Продажи по категориям (двухуровневые)
  // ======================================================================
  async salesByCategory(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    type: 'SERVICE' | 'PRODUCT' | 'all' = 'all',
  ) {
    const range = this.range(from, to);
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          companyId,
          createdAt: range,
          status: { not: 'CANCELLED' },
          ...(branchId ? { branchId } : {}),
        },
        ...(type !== 'all' ? { itemType: type } : {}),
      },
      select: {
        itemType: true,
        quantity: true,
        lineTotal: true,
        lineCost: true,
        service: {
          select: {
            categoryId: true,
            category: {
              select: {
                id: true,
                name: true,
                parentId: true,
                parent: { select: { id: true, name: true } },
              },
            },
          },
        },
        product: {
          select: {
            categoryId: true,
            category: {
              select: {
                id: true,
                name: true,
                parentId: true,
                parent: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    type Node = {
      categoryId: string;
      category: string;
      type: string;
      qty: number;
      revenue: number;
      cost: number;
      children: Map<string, Node>;
    };
    const roots = new Map<string, Node>();
    let total = 0;

    const mkNode = (id: string, name: string, t: string): Node => ({
      categoryId: id,
      category: name,
      type: t,
      qty: 0,
      revenue: 0,
      cost: 0,
      children: new Map(),
    });

    for (const it of items) {
      const cat = it.service?.category ?? it.product?.category ?? null;
      // Определяем верхний уровень и (если есть) дочерний
      let topId = 'none';
      let topName = 'Без категории';
      let childId: string | null = null;
      let childName: string | null = null;
      if (cat) {
        if (cat.parent) {
          topId = cat.parent.id;
          topName = cat.parent.name;
          childId = cat.id;
          childName = cat.name;
        } else {
          topId = cat.id;
          topName = cat.name;
        }
      }

      const revenue = Number(it.lineTotal);
      const cost = Number(it.lineCost);
      const qty = Number(it.quantity);
      total += revenue;

      const root = roots.get(topId) ?? mkNode(topId, topName, it.itemType);
      root.qty += qty;
      root.revenue += revenue;
      root.cost += cost;
      roots.set(topId, root);

      if (childId) {
        const ch =
          root.children.get(childId) ??
          mkNode(childId, childName!, it.itemType);
        ch.qty += qty;
        ch.revenue += revenue;
        ch.cost += cost;
        root.children.set(childId, ch);
      }
    }

    const fmt = (n: Node) => {
      const revenue = this.round2(n.revenue);
      const cost = this.round2(n.cost);
      const profit = this.round2(revenue - cost);
      return {
        categoryId: n.categoryId === 'none' ? null : n.categoryId,
        category: n.category,
        type: n.type,
        qty: this.round3(n.qty),
        revenue,
        cost,
        profit,
        margin: revenue > 0 ? this.round1((profit / revenue) * 100) : 0,
        sharePct: total > 0 ? this.round1((revenue / total) * 100) : 0,
      };
    };

    const list = Array.from(roots.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((r) => ({
        ...fmt(r),
        children: Array.from(r.children.values())
          .sort((a, b) => b.revenue - a.revenue)
          .map((c) => fmt(c)),
      }));

    return { total: this.round2(total), items: list };
  }

  // ======================================================================
  // 6) Продажи по клиентам
  // ======================================================================
  async salesByClient(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    limit = 100,
  ) {
    const range = this.range(from, to);
    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        createdAt: range,
        status: { not: 'CANCELLED' },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        clientId: true,
        total: true,
        returnedTotal: true,
        paid: true,
        balanceDue: true,
        createdAt: true,
        debtDueDate: true,
        client: { select: { fullName: true, phone: true } },
      },
    });

    const now = new Date();
    type Row = {
      clientId: string | null;
      client: string;
      phone: string;
      orders: number;
      revenue: number;
      paid: number;
      debt: number;
      overdueDebt: number;
      lastOrderDate: Date | null;
    };
    const agg = new Map<string, Row>();
    let total = 0;
    for (const o of orders) {
      const key = o.clientId ?? 'none';
      const revenue = Number(o.total) - Number(o.returnedTotal);
      total += revenue;
      const cur = agg.get(key) ?? {
        clientId: o.clientId,
        client: o.clientId
          ? (o.client?.fullName ?? o.client?.phone ?? 'Клиент')
          : 'Розница/без клиента',
        phone: o.client?.phone ?? '',
        orders: 0,
        revenue: 0,
        paid: 0,
        debt: 0,
        overdueDebt: 0,
        lastOrderDate: null,
      };
      cur.orders += 1;
      cur.revenue += revenue;
      cur.paid += Number(o.paid);
      cur.debt += Number(o.balanceDue);
      // Просрочка — только если срок долга задан и прошёл (долг без срока не
      // считаем просроченным, как и в остальном приложении).
      if (Number(o.balanceDue) > 0 && o.debtDueDate && o.debtDueDate < now) {
        cur.overdueDebt += Number(o.balanceDue);
      }
      if (!cur.lastOrderDate || o.createdAt > cur.lastOrderDate) {
        cur.lastOrderDate = o.createdAt;
      }
      agg.set(key, cur);
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const items = Array.from(agg.values())
      .map((r) => {
        const revenue = this.round2(r.revenue);
        return {
          clientId: r.clientId,
          client: r.client,
          phone: r.phone,
          orders: r.orders,
          revenue,
          paid: this.round2(r.paid),
          debt: this.round2(r.debt),
          avgCheck: r.orders ? this.round2(revenue / r.orders) : 0,
          sharePct: total > 0 ? this.round1((revenue / total) * 100) : 0,
          lastOrderDate: r.lastOrderDate,
          daysSinceLastOrder: r.lastOrderDate
            ? Math.floor((now.getTime() - r.lastOrderDate.getTime()) / dayMs)
            : null,
          overdueDebt: this.round2(r.overdueDebt),
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    return { total: this.round2(total), items };
  }

  // ======================================================================
  // 7) ABC-анализ
  // ======================================================================
  async abc(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    type: 'SERVICE' | 'PRODUCT' | 'all' = 'all',
  ) {
    // Переиспользуем агрегацию по позициям
    const rows = await this.salesByItem(
      companyId,
      from,
      to,
      branchId,
      type,
      undefined,
    );

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

    // Класс по кумулятивной доле выручки
    const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);
    let cum = 0;
    const classify = (cumPct: number): 'A' | 'B' | 'C' =>
      cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
    const withClass = new Map<
      string,
      { sharePct: number; cumPct: number; cls: 'A' | 'B' | 'C' }
    >();
    for (const r of byRevenue) {
      // Класс определяем по кумулятивной доле, где товар НАЧИНАЕТСЯ (до его
      // добавления): иначе доминирующий топ-товар (доля >80%) сразу перескакивал
      // за порог и уходил в B/C вместо A (medium).
      const cumPctBefore = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 0;
      cum += r.revenue;
      const cumPct = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 0;
      const sharePct = totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0;
      withClass.set(r.key, {
        sharePct: this.round1(sharePct),
        cumPct: this.round1(cumPct),
        cls: classify(cumPctBefore),
      });
    }

    // Второй проход — класс по прибыли
    const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
    const byProfit = [...rows].sort((a, b) => b.profit - a.profit);
    let cumP = 0;
    const profitClassMap = new Map<string, 'A' | 'B' | 'C'>();
    for (const r of byProfit) {
      cumP += r.profit;
      const cumPct = totalProfit > 0 ? (cumP / totalProfit) * 100 : 0;
      profitClassMap.set(r.key, classify(cumPct));
    }

    const items = byRevenue.map((r) => {
      const c = withClass.get(r.key)!;
      return {
        key: r.key,
        name: r.name,
        type: r.type,
        revenue: r.revenue,
        profit: r.profit,
        sharePct: c.sharePct,
        cumPct: c.cumPct,
        class: c.cls,
        profitClass: profitClassMap.get(r.key) ?? 'C',
      };
    });

    const summary = {
      A: this.abcClassSummary(items, 'A', totalRevenue),
      B: this.abcClassSummary(items, 'B', totalRevenue),
      C: this.abcClassSummary(items, 'C', totalRevenue),
    };

    return { items, summary };
  }

  private abcClassSummary(
    items: { class: string; revenue: number }[],
    cls: string,
    total: number,
  ) {
    const sub = items.filter((i) => i.class === cls);
    const revenue = this.round2(sub.reduce((s, i) => s + i.revenue, 0));
    return {
      count: sub.length,
      revenue,
      sharePct: total > 0 ? this.round1((revenue / total) * 100) : 0,
    };
  }

  // ======================================================================
  // 8) Прибыль по заказам за период (+ branchId, доп. поля)
  // ======================================================================
  async profit(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
  ) {
    const range = this.range(from, to);

    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        createdAt: range,
        status: { not: 'CANCELLED' },
        ...(branchId ? { branchId } : {}),
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
    let totalReturns = 0;
    let zeroCostRevenue = 0;
    const list = orders.map((o) => {
      const revenue =
        o.items.reduce((s, it) => s + Number(it.lineTotal), 0) -
        Number(o.returnedTotal);
      const cost =
        o.items.reduce((s, it) => s + Number(it.lineCost), 0) -
        Number(o.returnedCost);
      const profit = this.round2(revenue - cost);
      totalRevenue += revenue;
      totalCost += cost;
      totalReturns += Number(o.returnedTotal);
      // Доля выручки с нулевой себестоимостью
      for (const it of o.items) {
        if (Number(it.lineCost) <= 0 && Number(it.lineTotal) > 0) {
          zeroCostRevenue += Number(it.lineTotal);
        }
      }
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        date: o.createdAt,
        client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
        revenue: this.round2(revenue),
        cost: this.round2(cost),
        profit,
        margin: revenue > 0 ? this.round1((profit / revenue) * 100) : 0,
        loss: profit < 0,
      };
    });

    totalRevenue = this.round2(totalRevenue);
    totalCost = this.round2(totalCost);
    const totalProfit = this.round2(totalRevenue - totalCost);

    return {
      from: range.gte,
      to: range.lte,
      ordersCount: list.length,
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalProfit,
      margin:
        totalRevenue > 0 ? this.round1((totalProfit / totalRevenue) * 100) : 0,
      totalReturns: this.round2(totalReturns),
      zeroCostShare:
        totalRevenue > 0
          ? this.round1((zeroCostRevenue / totalRevenue) * 100)
          : 0,
      items: list,
    };
  }

  // ======================================================================
  // 9) Расходы кассы по категориям (+ branchId через shift.branch)
  // ======================================================================
  async expenses(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
  ) {
    const range = this.range(from, to);
    const movements = await this.prisma.cashMovement.findMany({
      where: {
        companyId,
        type: 'OUT',
        createdAt: range,
        NOT: { category: 'Возвраты' },
        ...(branchId ? { shift: { branchId } } : {}),
      },
      select: { amount: true, category: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const byCat = new Map<string, { amount: number; count: number }>();
    let total = 0;
    for (const m of movements) {
      const cat = m.category?.trim() || 'Без категории';
      const amt = Number(m.amount);
      const cur = byCat.get(cat) ?? { amount: 0, count: 0 };
      cur.amount = this.round2(cur.amount + amt);
      cur.count += 1;
      byCat.set(cat, cur);
      total += amt;
    }

    total = this.round2(total);
    return {
      from: range.gte,
      to: range.lte,
      total,
      byCategory: Array.from(byCat.entries())
        .map(([category, v]) => ({
          category,
          amount: v.amount,
          count: v.count,
          sharePct: total > 0 ? this.round1((v.amount / total) * 100) : 0,
        }))
        .sort((a, b) => b.amount - a.amount),
      items: movements.map((m) => ({
        date: m.createdAt,
        category: m.category?.trim() || 'Без категории',
        reason: m.reason ?? '',
        amount: Number(m.amount),
      })),
    };
  }

  // ======================================================================
  // 10) Денежный поток
  // ======================================================================
  async cashflow(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    const range = this.range(from, to);

    // Приток — платежи (без DEBT), по методам
    const payments = await this.prisma.payment.findMany({
      where: {
        companyId,
        createdAt: range,
        method: { not: PaymentMethod.DEBT },
        ...(branchId ? { order: { branchId } } : {}),
      },
      select: { amount: true, method: true, createdAt: true, shiftId: true },
    });

    // Отток — расходы кассы (OUT). «Возвраты» отдельно (refundsCash), не в outflow.
    const movements = await this.prisma.cashMovement.findMany({
      where: {
        companyId,
        type: 'OUT',
        createdAt: range,
        ...(branchId ? { shift: { branchId } } : {}),
      },
      select: { amount: true, category: true, createdAt: true, shiftId: true },
    });

    // Оплаты поставщикам (нет привязки к филиалу — фильтр только по компании)
    const supplierPayments = branchId
      ? []
      : await this.prisma.supplierPayment.findMany({
          where: { companyId, createdAt: range },
          select: { amount: true, createdAt: true },
        });

    const byMethod = { cash: 0, card: 0, qr: 0, transfer: 0 };
    let inflow = 0;
    for (const p of payments) {
      const a = Number(p.amount);
      inflow += a;
      if (p.method === 'CASH') byMethod.cash += a;
      else if (p.method === 'CARD') byMethod.card += a;
      else if (p.method === 'QR') byMethod.qr += a;
      else if (p.method === 'TRANSFER') byMethod.transfer += a;
    }

    const outByCat = new Map<string, number>();
    let outflowCash = 0;
    let refundsCash = 0;
    let supplierMovementTotal = 0;
    for (const m of movements) {
      const cat = m.category?.trim() || 'Без категории';
      const a = Number(m.amount);
      if (cat === 'Возвраты') {
        refundsCash += a;
        continue;
      }
      if (this.isSupplierExpenseCategory(cat)) supplierMovementTotal += a;
      outflowCash += a;
      outByCat.set(cat, this.round2((outByCat.get(cat) ?? 0) + a));
    }
    const supplierTotal = supplierPayments.reduce(
      (s, p) => s + Number(p.amount),
      0,
    );
    const supplierUntrackedTotal = this.round2(
      Math.max(0, supplierTotal - supplierMovementTotal),
    );
    const supplierLabel =
      '\u041e\u043f\u043b\u0430\u0442\u0430 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430\u043c';
    if (supplierUntrackedTotal > 0) {
      outByCat.set(
        supplierLabel,
        this.round2(
          (outByCat.get(supplierLabel) ?? 0) + supplierUntrackedTotal,
        ),
      );
    }
    const outflow = this.round2(outflowCash + supplierUntrackedTotal);

    // Смены за период — кассовая сверка (только наличные)
    const shifts = await this.prisma.cashShift.findMany({
      where: {
        companyId,
        openedAt: range,
        ...(branchId ? { branchId } : {}),
      },
      select: { id: true, openingBalance: true, closingBalance: true },
    });
    // Сверка кассы — ТОЛЬКО по закрытым сменам. Раньше openingBalance суммировался
    // по ВСЕМ сменам, а closingBalance — лишь по закрытым; из-за этого открытая
    // смена давала фантомную недостачу в discrepancy. Теперь opening/closing и
    // приток/отток для сверки берём по одному множеству закрытых смен (по shiftId,
    // как в Z-отчёте), а не за весь период (medium).
    const closedShiftIds = new Set<string>();
    let openingBalance = 0;
    let closingBalance = 0;
    let openShiftsCount = 0;
    for (const s of shifts) {
      if (s.closingBalance === null) {
        openShiftsCount += 1;
      } else {
        openingBalance += Number(s.openingBalance);
        closingBalance += Number(s.closingBalance);
        closedShiftIds.add(s.id);
      }
    }
    // Наличный приток / отток / возвраты закрытых смен (по shiftId)
    let closedCashIn = 0;
    for (const p of payments) {
      if (p.method === 'CASH' && p.shiftId && closedShiftIds.has(p.shiftId)) {
        closedCashIn += Number(p.amount);
      }
    }
    let closedCashOut = 0;
    let closedRefunds = 0;
    for (const m of movements) {
      if (!m.shiftId || !closedShiftIds.has(m.shiftId)) continue;
      const a = Number(m.amount);
      if (m.category?.trim() === 'Возвраты') closedRefunds += a;
      else closedCashOut += a;
    }
    // Ожидаемый остаток = открытие + наличный приток − наличный отток − возвраты наличными
    const expectedClosing = this.round2(
      openingBalance + closedCashIn - closedCashOut - closedRefunds,
    );

    // Бакеты
    const buckets = this.buildBuckets(range, groupBy);
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    const bucketRefunds = new Array(buckets.length).fill(0); // возвраты кэшем по бакету (P0-4)
    for (const p of payments) {
      const i = idx.get(this.bucketKey(p.createdAt, groupBy));
      if (i !== undefined) buckets[i].collected += Number(p.amount);
    }
    for (const m of movements) {
      const cat = m.category?.trim() || 'Без категории';
      const i = idx.get(this.bucketKey(m.createdAt, groupBy));
      if (i === undefined) continue;
      // Возвраты — отдельно (как в топ-итоге), но участвуют в per-bucket net.
      if (cat === 'Возвраты') {
        bucketRefunds[i] += Number(m.amount);
        continue;
      }
      buckets[i].billed += Number(m.amount); // billed используем как «отток» в бакете
    }
    let supplierBucketRemainder = supplierUntrackedTotal;
    for (const p of supplierPayments) {
      if (supplierBucketRemainder <= 0) break;
      const i = idx.get(this.bucketKey(p.createdAt, groupBy));
      const amount = Math.min(Number(p.amount), supplierBucketRemainder);
      if (i !== undefined) buckets[i].billed += amount;
      supplierBucketRemainder = this.round2(supplierBucketRemainder - amount);
    }

    let cumNet = 0;
    const bucketsOut = buckets.map((b, i) => {
      const bin = this.round2(b.collected);
      const bout = this.round2(b.billed);
      const bref = this.round2(bucketRefunds[i]);
      const bnet = this.round2(bin - bout - bref); // вычитаем и возвраты кэшем (P0-4)
      cumNet += bnet;
      return {
        date: b.key,
        label: b.label,
        inflow: bin,
        outflow: bout,
        refundsCash: bref,
        net: bnet,
        cumNet: this.round2(cumNet),
      };
    });

    return {
      from: range.gte,
      to: range.lte,
      inflow: this.round2(inflow),
      outflow,
      // Возвраты кэшем — реальный отток из кассы, но показываются отдельной
      // строкой refundsCash. В чистый поток их надо вычесть, иначе net завышен и
      // не сходится с expectedClosing в этом же ответе (P0-4).
      net: this.round2(inflow - outflow - refundsCash),
      byMethod,
      outByCategory: Array.from(outByCat.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      supplierPayments: this.round2(supplierTotal),
      refundsCash: this.round2(refundsCash),
      openingBalance: this.round2(openingBalance),
      closingBalance: this.round2(closingBalance),
      expectedClosing,
      discrepancy: this.round2(closingBalance - expectedClosing),
      openShiftsCount,
      buckets: bucketsOut,
    };
  }

  // ======================================================================
  // 11) Дебиторка (aging)
  // ======================================================================
  async receivables(companyId: string, branchId?: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        status: { not: 'CANCELLED' },
        balanceDue: { gt: new Prisma.Decimal(0) },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        paid: true,
        balanceDue: true,
        debtDueDate: true,
        createdAt: true,
        client: { select: { fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const aging = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0 };
    let total = 0;
    let overdueTotal = 0;
    let overdueDaysSum = 0;
    let overdueCount = 0;

    const items = orders.map((o) => {
      const debt = Number(o.balanceDue);
      total += debt;
      // Просрочка только при заданном сроке (как в остальном приложении):
      // долг без debtDueDate НЕ считается просроченным → попадает в «current».
      const overdue = o.debtDueDate != null && o.debtDueDate < now;
      const daysOverdue =
        overdue && o.debtDueDate
          ? Math.floor((now.getTime() - o.debtDueDate.getTime()) / dayMs)
          : 0;
      if (!overdue) aging.current += debt;
      else if (daysOverdue <= 30) aging.d1_30 += debt;
      else if (daysOverdue <= 60) aging.d31_60 += debt;
      else aging.d60plus += debt;
      if (overdue) {
        overdueTotal += debt;
        overdueDaysSum += daysOverdue;
        overdueCount += 1;
      }
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
        phone: o.client?.phone ?? '',
        total: Number(o.total),
        paid: Number(o.paid),
        debt: this.round2(debt),
        dueDate: o.debtDueDate,
        overdue,
        daysOverdue,
      };
    });

    const badDebtEstimate = this.round2(
      aging.d31_60 * 0.3 + aging.d60plus * 0.7,
    );

    return {
      total: this.round2(total),
      count: items.length,
      aging: {
        current: this.round2(aging.current),
        d1_30: this.round2(aging.d1_30),
        d31_60: this.round2(aging.d31_60),
        d60plus: this.round2(aging.d60plus),
      },
      overdueTotal: this.round2(overdueTotal),
      avgDaysOverdue: overdueCount
        ? Math.round(overdueDaysSum / overdueCount)
        : 0,
      topDebtors: [...items].sort((a, b) => b.debt - a.debt).slice(0, 5),
      badDebtEstimate,
      items,
    };
  }

  // ======================================================================
  // 12) Долги клиентов (БЕЗ ИЗМЕНЕНИЙ — обратная совместимость)
  // ======================================================================
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
    const total = Number(list.reduce((s, d) => s + d.debt, 0).toFixed(2));
    return { total, count: list.length, items: list };
  }

  // ======================================================================
  // 13) Кредиторка (наши долги поставщикам)
  // ======================================================================
  async payables(companyId: string) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { companyId, debt: { gt: new Prisma.Decimal(0) } },
      select: {
        id: true,
        name: true,
        phone: true,
        debt: true,
        receipts: {
          where: { paymentStatus: { not: 'PAID' } },
          select: { dueDate: true, total: true, paidAmount: true, date: true },
        },
      },
    });

    const now = new Date();
    const aging = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0 };
    let overdueTotal = 0;
    let total = 0;

    const items = suppliers.map((s) => {
      const debt = Number(s.debt);
      total += debt;
      // Ближайший СРОК оплаты — просрочка только при заданном dueDate (P0-24).
      // Долг без срока не считается просроченным (как в receivables).
      let nearest: Date | null = null;
      for (const r of s.receipts) {
        if (!r.dueDate) continue;
        if (!nearest || r.dueDate < nearest) nearest = r.dueDate;
      }
      const overdue = nearest ? nearest < now : false;
      return {
        supplierId: s.id,
        supplier: s.name,
        phone: s.phone ?? '',
        debt: this.round2(debt),
        dueDate: nearest,
        overdue,
      };
    });

    // Aging по срокам приходов (сумма total − paidAmount)
    const receipts = suppliers.flatMap((s) => s.receipts);
    const dayMs = 24 * 60 * 60 * 1000;
    for (const r of receipts) {
      const amount = Number(r.total) - Number(r.paidAmount);
      if (amount <= 0) continue;
      // Просрочка только при заданном сроке; без dueDate → «current» (P0-24).
      const due = r.dueDate;
      const overdue = due != null && due < now;
      const daysOverdue = overdue
        ? Math.floor((now.getTime() - due.getTime()) / dayMs)
        : 0;
      if (!overdue) aging.current += amount;
      else if (daysOverdue <= 30) aging.d1_30 += amount;
      else if (daysOverdue <= 60) aging.d31_60 += amount;
      else aging.d60plus += amount;
      if (overdue) overdueTotal += amount;
    }

    // Свести aging-бакеты к headline total. Источники разные: total = Σ
    // Supplier.debt (каноничный долг), а бакеты собраны по неоплаченным приёмкам,
    // поэтому Σ бакетов может не совпадать с total. Расхождение (долг без
    // датированных приёмок / ручные корректировки) относим к «current» (не
    // просрочено), чтобы Σ бакетов всегда сходилась с итогом (medium).
    const bucketedRaw =
      aging.current + aging.d1_30 + aging.d31_60 + aging.d60plus;
    const residual = this.round2(total - bucketedRaw);
    if (residual > 0) {
      aging.current += residual;
    } else if (residual < 0) {
      // Приёмки показывают больше, чем числится по Supplier.debt (расхождение
      // данных) — headline берём по приёмкам, чтобы бакеты сошлись с итогом.
      total = bucketedRaw;
    }

    return {
      total: this.round2(total),
      count: items.length,
      aging: {
        current: this.round2(aging.current),
        d1_30: this.round2(aging.d1_30),
        d31_60: this.round2(aging.d31_60),
        d60plus: this.round2(aging.d60plus),
      },
      overdueTotal: this.round2(overdueTotal),
      items: items.sort((a, b) => b.debt - a.debt),
    };
  }

  // ======================================================================
  // 14) Закупки за период
  // ======================================================================
  async purchasing(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    supplierId?: string,
  ) {
    const range = this.range(from, to);
    const receipts = await this.prisma.stockReceipt.findMany({
      where: {
        companyId,
        date: range,
        ...(branchId ? { branchId } : {}),
        ...(supplierId ? { supplierId } : {}),
      },
      select: {
        id: true,
        date: true,
        total: true,
        paidAmount: true,
        paymentStatus: true,
        supplierId: true,
        supplier: { select: { name: true } },
        items: {
          select: {
            productId: true,
            quantity: true,
            cost: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    let total = 0;
    let paid = 0;
    const bySupplier = new Map<
      string,
      {
        supplierId: string | null;
        supplier: string;
        receipts: number;
        total: number;
        paid: number;
      }
    >();
    const byStatus = { paid: 0, partial: 0, debt: 0 };
    const topProducts = new Map<
      string,
      {
        productId: string;
        name: string;
        qty: number;
        amount: number;
        lastDate: Date | null;
      }
    >();

    for (const r of receipts) {
      const t = Number(r.total);
      const p = Number(r.paidAmount);
      total += t;
      paid += p;
      const sKey = r.supplierId ?? 'none';
      const sCur = bySupplier.get(sKey) ?? {
        supplierId: r.supplierId,
        supplier: r.supplier?.name ?? 'Без поставщика',
        receipts: 0,
        total: 0,
        paid: 0,
      };
      sCur.receipts += 1;
      sCur.total += t;
      sCur.paid += p;
      bySupplier.set(sKey, sCur);

      if (r.paymentStatus === 'PAID') byStatus.paid += t;
      else if (r.paymentStatus === 'PARTIAL') byStatus.partial += t;
      else byStatus.debt += t;

      for (const it of r.items) {
        const pCur = topProducts.get(it.productId) ?? {
          productId: it.productId,
          name: it.product?.name ?? 'Товар',
          qty: 0,
          amount: 0,
          lastDate: null,
        };
        pCur.qty += Number(it.quantity);
        pCur.amount += Number(it.quantity) * Number(it.cost);
        if (!pCur.lastDate || r.date > pCur.lastDate) pCur.lastDate = r.date;
        topProducts.set(it.productId, pCur);
      }
    }

    total = this.round2(total);
    paid = this.round2(paid);

    return {
      total,
      paid,
      debt: this.round2(total - paid),
      receiptsCount: receipts.length,
      avgReceipt: receipts.length ? this.round2(total / receipts.length) : 0,
      byStatus: {
        paid: this.round2(byStatus.paid),
        partial: this.round2(byStatus.partial),
        debt: this.round2(byStatus.debt),
      },
      bySupplier: Array.from(bySupplier.values())
        .map((s) => ({
          supplierId: s.supplierId,
          supplier: s.supplier,
          receipts: s.receipts,
          total: this.round2(s.total),
          paid: this.round2(s.paid),
          debt: this.round2(s.total - s.paid),
        }))
        .sort((a, b) => b.total - a.total),
      topProducts: Array.from(topProducts.values())
        .map((p) => ({
          productId: p.productId,
          name: p.name,
          qty: this.round3(p.qty),
          amount: this.round2(p.amount),
          avgCost: p.qty > 0 ? this.round2(p.amount / p.qty) : 0,
          lastReceiptDate: p.lastDate,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 50),
    };
  }

  // ======================================================================
  // 15) Складские остатки
  // ======================================================================
  async inventory(companyId: string, branchId?: string) {
    const stocks = await this.prisma.stock.findMany({
      where: {
        // Оценка склада включает ВСЕ не удалённые товары (в т.ч. неактивные —
        // они физически лежат на складе и имеют стоимость). isActive не
        // фильтруем, иначе totalValue/totalQty занижаются.
        product: { companyId, deletedAt: null },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        quantity: true,
        productId: true,
        product: {
          select: {
            name: true,
            purchasePrice: true,
            salePrice: true,
            minStock: true,
            category: { select: { name: true } },
            unit: { select: { shortName: true } },
          },
        },
      },
    });

    // Средний дневной расход за 30 дней — для daysOfCover
    const usageFrom = new Date();
    usageFrom.setDate(usageFrom.getDate() - 30);
    usageFrom.setHours(0, 0, 0, 0);
    const usage = await this.prisma.stockMovement.groupBy({
      by: ['productId'],
      where: {
        companyId,
        type: 'OUT',
        createdAt: { gte: usageFrom },
        ...(branchId ? { branchId } : {}),
      },
      _sum: { quantity: true },
    });
    const usageBy = new Map(
      usage.map((u) => [u.productId, Number(u._sum.quantity ?? 0) / 30]),
    );

    let totalValue = 0;
    let totalQty = 0;
    let potentialProfit = 0;
    const lowStock: any[] = [];
    const outOfStock: any[] = [];
    const negativeStock: any[] = [];
    const items = stocks.map((s) => {
      const qty = Number(s.quantity);
      const pp = Number(s.product.purchasePrice ?? 0);
      const value = this.round2(qty * pp);
      totalValue += qty * pp;
      totalQty += qty;
      potentialProfit += qty * (Number(s.product.salePrice ?? 0) - pp);
      const minStock = Number(s.product.minStock);
      const unit = s.product.unit?.shortName ?? '';
      const row = {
        productId: s.productId,
        name: s.product.name,
        category: s.product.category?.name ?? 'Без категории',
        unit,
        qty: this.round3(qty),
        purchasePrice: pp,
        value,
        minStock,
      };
      const avgUse = usageBy.get(s.productId) ?? 0;
      if (qty <= 0) outOfStock.push(row);
      else if (minStock > 0 && qty <= minStock) lowStock.push(row);
      if (qty < 0) negativeStock.push(row);
      return {
        ...row,
        daysOfCover: avgUse > 0 ? this.round1(qty / avgUse) : null,
      };
    });

    return {
      totalValue: this.round2(totalValue),
      totalSku: items.length,
      totalQty: this.round3(totalQty),
      potentialProfit: this.round2(potentialProfit),
      lowStock: lowStock.map((r) => ({
        productId: r.productId,
        name: r.name,
        qty: r.qty,
        minStock: r.minStock,
        unit: r.unit,
      })),
      outOfStock: outOfStock.map((r) => ({
        productId: r.productId,
        name: r.name,
        qty: r.qty,
        unit: r.unit,
      })),
      negativeStock: negativeStock.map((r) => ({
        productId: r.productId,
        name: r.name,
        qty: r.qty,
        unit: r.unit,
      })),
      items,
    };
  }

  // ======================================================================
  // 16) Движения склада
  // ======================================================================
  async stockMovements(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    productId?: string,
    type?: string,
  ) {
    const range = this.range(from, to);
    const movementType = this.parseEnumValue(
      'type',
      type,
      StockMovementType,
    );
    const where: Prisma.StockMovementWhereInput = {
      companyId,
      createdAt: range,
      ...(branchId ? { branchId } : {}),
      ...(productId ? { productId } : {}),
      ...(movementType ? { type: movementType } : {}),
    };

    // Сводка по типам
    const grouped = await this.prisma.stockMovement.groupBy({
      by: ['type'],
      where,
      _count: true,
      _sum: { quantity: true },
    });
    const byType = grouped.map((g) => ({
      type: g.type,
      count: g._count,
      qty: this.round3(Number(g._sum.quantity ?? 0)),
    }));

    // Сводка по товарам (для writeOffRate и т.п.)
    const byProductGrouped = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'type'],
      where,
      _sum: { quantity: true },
    });
    const productIds = Array.from(
      new Set(byProductGrouped.map((g) => g.productId)),
    );
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(products.map((p) => [p.id, p.name]));
    const byProductMap = new Map<
      string,
      {
        productId: string;
        name: string;
        inQty: number;
        outQty: number;
        writeOffQty: number;
      }
    >();
    for (const g of byProductGrouped) {
      const cur = byProductMap.get(g.productId) ?? {
        productId: g.productId,
        name: nameBy.get(g.productId) ?? 'Товар',
        inQty: 0,
        outQty: 0,
        writeOffQty: 0,
      };
      const q = Number(g._sum.quantity ?? 0);
      if (g.type === 'IN' || g.type === 'RETURN') cur.inQty += q;
      else if (g.type === 'OUT') cur.outQty += q;
      else if (g.type === 'WRITE_OFF') cur.writeOffQty += q;
      byProductMap.set(g.productId, cur);
    }
    const byProduct = Array.from(byProductMap.values()).map((p) => ({
      productId: p.productId,
      name: p.name,
      inQty: this.round3(p.inQty),
      outQty: this.round3(p.outQty),
      net: this.round3(p.inQty - p.outQty - p.writeOffQty),
      writeOffRate:
        p.inQty > 0 ? this.round1((p.writeOffQty / p.inQty) * 100) : null,
    }));

    // Списания (WriteOff — отдельная модель с себестоимостью)
    const writeOffs = await this.prisma.writeOff.findMany({
      where: {
        companyId,
        createdAt: range,
        ...(branchId ? { branchId } : {}),
        ...(productId ? { productId } : {}),
      },
      select: {
        quantity: true,
        cost: true,
        reason: true,
        createdAt: true,
        productId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const woProductIds = Array.from(new Set(writeOffs.map((w) => w.productId)));
    const woProducts = await this.prisma.product.findMany({
      where: { id: { in: woProductIds } },
      select: { id: true, name: true },
    });
    const woNameBy = new Map(woProducts.map((p) => [p.id, p.name]));
    let woTotal = 0;
    let woCost = 0;
    const woItems = writeOffs.map((w) => {
      woTotal += Number(w.quantity);
      woCost += Number(w.cost);
      return {
        date: w.createdAt,
        product: woNameBy.get(w.productId) ?? 'Товар',
        qty: this.round3(Number(w.quantity)),
        cost: this.round2(Number(w.cost)),
        reason: w.reason ?? '',
      };
    });

    // Список движений (cap 500)
    const movements = await this.prisma.stockMovement.findMany({
      where,
      select: {
        createdAt: true,
        type: true,
        quantity: true,
        beforeQty: true,
        afterQty: true,
        reason: true,
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return {
      byType,
      byProduct,
      writeOffs: {
        total: this.round3(woTotal),
        cost: this.round2(woCost),
        items: woItems,
      },
      items: movements.map((m) => ({
        date: m.createdAt,
        product: m.product?.name ?? 'Товар',
        type: m.type,
        qty: this.round3(Number(m.quantity)),
        before: m.beforeQty !== null ? Number(m.beforeQty) : null,
        after: m.afterQty !== null ? Number(m.afterQty) : null,
        reason: m.reason ?? '',
      })),
    };
  }

  // ======================================================================
  // 17) Производство
  // ======================================================================
  async production(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
  ) {
    const range = this.range(from, to);
    // Задания периода (по дате создания), не удалённые.
    // Фильтр по филиалу — через order.branchId.
    const jobs = await this.prisma.productionJob.findMany({
      where: {
        companyId,
        deletedAt: null,
        createdAt: range,
        ...(branchId ? { order: { branchId } } : {}),
      },
      select: {
        status: true,
        equipmentId: true,
        assignedUserId: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        order: { select: { deadline: true } },
      },
    });

    const now = new Date();
    const byStatusMap = new Map<string, number>();
    let completed = 0;
    let rework = 0;
    let onTime = 0;
    let onTimeEligible = 0;
    let overdueInWork = 0;
    let urgentInWork = 0;
    let unassignedJobs = 0;
    let leadSum = 0;
    let leadCount = 0;

    const activeStatuses = new Set([
      'PENDING',
      'PRINTING',
      'CUTTING',
      'BINDING',
      'PACKAGING',
      'PAUSED',
      'REWORK',
    ]);

    for (const j of jobs) {
      byStatusMap.set(j.status, (byStatusMap.get(j.status) ?? 0) + 1);
      if (j.status === ProductionStatus.COMPLETED) {
        completed += 1;
        // В знаменатель onTimeRate берём только задания с измеримым сроком (есть
        // дедлайн заказа и время завершения). Иначе завершённые задания без
        // дедлайна занижали бы долю «в срок» (они не могут попасть в onTime).
        if (j.order?.deadline && j.completedAt) {
          onTimeEligible += 1;
          if (j.completedAt <= j.order.deadline) onTime += 1;
        }
        // Lead time (часы), отрицательные отбрасываем
        if (j.completedAt) {
          const start = j.startedAt ?? j.createdAt;
          const h = (j.completedAt.getTime() - start.getTime()) / 3600000;
          if (h >= 0) {
            leadSum += h;
            leadCount += 1;
          }
        }
      } else if (j.status === ProductionStatus.REWORK) {
        rework += 1;
      }
      if (activeStatuses.has(j.status)) {
        if (j.order?.deadline && j.order.deadline < now) overdueInWork += 1;
        if (j.equipmentId === null || j.assignedUserId === null) {
          unassignedJobs += 1;
        }
      }
    }

    // Срочные в работе — по urgency заказа (отдельный запрос активных заданий)
    const urgent = await this.prisma.productionJob.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: Array.from(activeStatuses) as ProductionStatus[] },
        order: {
          urgency: { in: ['URGENT', 'EXPRESS'] },
          ...(branchId ? { branchId } : {}),
        },
      },
    });
    urgentInWork = urgent;

    const reworkRate =
      completed + rework > 0
        ? this.round1((rework / (completed + rework)) * 100)
        : 0;

    return {
      jobsTotal: jobs.length,
      completed,
      rework,
      reworkRate,
      onTimeRate:
        onTimeEligible > 0 ? this.round1((onTime / onTimeEligible) * 100) : 0,
      overdueInWork,
      urgentInWork,
      unassignedJobs,
      throughput: completed,
      avgLeadTimeHours: leadCount > 0 ? this.round1(leadSum / leadCount) : 0,
      byStatus: Array.from(byStatusMap.entries()).map(([status, count]) => ({
        status,
        count,
      })),
      equipment: await this.equipmentLoad(companyId, branchId),
    };
  }

  // ======================================================================
  // 18) Загрузка оборудования (+ branchId)
  // ======================================================================
  async equipmentLoad(companyId: string, branchId?: string) {
    const equipment = await this.prisma.equipment.findMany({
      where: { companyId, deletedAt: null, ...(branchId ? { branchId } : {}) },
      select: { id: true, name: true, type: true, status: true },
      orderBy: { name: 'asc' },
    });

    const jobs = await this.prisma.productionJob.groupBy({
      by: ['equipmentId', 'status'],
      where: {
        companyId,
        deletedAt: null,
        equipmentId: { not: null },
        ...(branchId ? { equipment: { branchId } } : {}),
      },
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
      const completed = r.COMPLETED ?? 0;
      const rework = r.REWORK ?? 0;
      const total = Object.values(r).reduce((s, n) => s + n, 0);
      return {
        id: e.id,
        name: e.name,
        type: e.type ?? '—',
        status: e.status,
        inQueue: r.PENDING ?? 0,
        inWork: active(r) - (r.PENDING ?? 0),
        active: active(r),
        completed,
        rework,
        total,
        reworkRate:
          completed + rework > 0
            ? this.round1((rework / (completed + rework)) * 100)
            : 0,
        utilizationPct: total > 0 ? this.round1((active(r) / total) * 100) : 0,
      };
    });
  }

  // ======================================================================
  // 19) Эффективность сотрудников (+ collected, branchId)
  // ======================================================================
  async staffPerformance(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
  ) {
    const range = this.range(from, to);

    const users = await this.prisma.user.findMany({
      where: { companyId, ...(branchId ? { branchId } : {}) },
      select: { id: true, fullName: true, role: { select: { name: true } } },
    });

    // Заказы, созданные сотрудником (в периоде, не отменённые)
    const orders = await this.prisma.order.groupBy({
      by: ['createdById'],
      where: {
        companyId,
        createdAt: range,
        status: { not: 'CANCELLED' },
        createdById: { not: null },
        ...(branchId ? { branchId } : {}),
      },
      _count: true,
      _sum: { total: true },
    });
    // Производство: завершённые и брак (по завершению/периоду)
    const prodDone = await this.prisma.productionJob.groupBy({
      by: ['assignedUserId'],
      where: {
        companyId,
        deletedAt: null,
        status: ProductionStatus.COMPLETED,
        completedAt: range,
        assignedUserId: { not: null },
      },
      _count: true,
    });
    const prodRework = await this.prisma.productionJob.groupBy({
      by: ['assignedUserId'],
      where: {
        companyId,
        deletedAt: null,
        status: ProductionStatus.REWORK,
        createdAt: range,
        assignedUserId: { not: null },
      },
      _count: true,
    });
    // Задачи выполненные
    const tasks = await this.prisma.task.groupBy({
      by: ['assignedUserId'],
      where: {
        companyId,
        status: TaskStatus.DONE,
        // У задачи нет времени завершения — привязываем к периоду по createdAt,
        // чтобы метрика была период-зависимой, как остальные в строке сотрудника.
        createdAt: range,
        assignedUserId: { not: null },
      },
      _count: true,
    });
    // Собрано денег сотрудником (по Payment.userId, без DEBT)
    const collected = await this.prisma.payment.groupBy({
      by: ['userId'],
      where: {
        companyId,
        createdAt: range,
        method: { not: PaymentMethod.DEBT },
        userId: { not: null },
        ...(branchId ? { order: { branchId } } : {}),
      },
      _sum: { amount: true },
    });
    // Активные задания сейчас
    const activeNow = await this.prisma.productionJob.groupBy({
      by: ['assignedUserId'],
      where: {
        companyId,
        deletedAt: null,
        status: {
          in: [
            'PENDING',
            'PRINTING',
            'CUTTING',
            'BINDING',
            'PACKAGING',
            'PAUSED',
            'REWORK',
          ] as ProductionStatus[],
        },
        assignedUserId: { not: null },
      },
      _count: true,
    });

    const ordersBy = new Map(orders.map((o) => [o.createdById, o]));
    const prodBy = new Map(prodDone.map((p) => [p.assignedUserId, p._count]));
    const reworkBy = new Map(
      prodRework.map((p) => [p.assignedUserId, p._count]),
    );
    const tasksBy = new Map(tasks.map((t) => [t.assignedUserId, t._count]));
    const collectedBy = new Map(
      collected.map((c) => [c.userId, Number(c._sum.amount ?? 0)]),
    );
    const activeBy = new Map(
      activeNow.map((a) => [a.assignedUserId, a._count]),
    );

    return users
      .map((u) => {
        const o = ordersBy.get(u.id);
        const ordersCreated = o?._count ?? 0;
        const salesSum = Number(o?._sum.total ?? 0);
        const done = prodBy.get(u.id) ?? 0;
        const rw = reworkBy.get(u.id) ?? 0;
        return {
          id: u.id,
          name: u.fullName,
          role: u.role?.name ?? '—',
          ordersCreated,
          salesSum,
          productionDone: done,
          tasksDone: tasksBy.get(u.id) ?? 0,
          collected: this.round2(collectedBy.get(u.id) ?? 0),
          avgCheck: ordersCreated ? this.round2(salesSum / ordersCreated) : 0,
          personalReworkRate:
            done + rw > 0 ? this.round1((rw / (done + rw)) * 100) : 0,
          activeJobsNow: activeBy.get(u.id) ?? 0,
        };
      })
      .sort((a, b) => b.salesSum - a.salesSum);
  }

  // ======================================================================
  // 20) Реестр заказов (для выгрузки)
  // ======================================================================
  async ordersRegistry(
    companyId: string,
    from?: string,
    to?: string,
    branchId?: string,
    status?: string,
    type?: string,
    paymentStatus?: string,
    urgency?: string,
    clientId?: string,
    limit = 500,
  ) {
    const range = this.range(from, to);
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const orderStatus = this.parseEnumValue('status', status, OrderStatus);
    const orderType = this.parseEnumValue('type', type, OrderType);
    const orderPaymentStatus = this.parseEnumValue(
      'paymentStatus',
      paymentStatus,
      PaymentStatus,
    );
    const orderUrgency = this.parseEnumValue(
      'urgency',
      urgency,
      OrderUrgency,
    );

    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        createdAt: range,
        ...(branchId ? { branchId } : {}),
        ...(orderStatus ? { status: orderStatus } : {}),
        ...(orderType ? { orderType } : {}),
        ...(orderPaymentStatus ? { paymentStatus: orderPaymentStatus } : {}),
        ...(orderUrgency ? { urgency: orderUrgency } : {}),
        ...(clientId ? { clientId } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        orderType: true,
        status: true,
        paymentStatus: true,
        urgency: true,
        deadline: true,
        total: true,
        paid: true,
        balanceDue: true,
        returnedTotal: true,
        client: { select: { fullName: true, phone: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    let total = 0;
    let paid = 0;
    let debt = 0;
    let returned = 0;
    const items = orders.map((o) => {
      // Отменённые заказы остаются в списке (для выгрузки), но НЕ входят в итоги —
      // иначе реестр расходится с прочими отчётами (medium).
      if (o.status !== 'CANCELLED') {
        total += Number(o.total);
        paid += Number(o.paid);
        debt += Number(o.balanceDue);
        returned += Number(o.returnedTotal);
      }
      const overdue =
        !!o.deadline && o.deadline < now && o.status !== 'DELIVERED';
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        date: o.createdAt,
        client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
        phone: o.client?.phone ?? '',
        type: o.orderType,
        status: o.status,
        paymentStatus: o.paymentStatus,
        urgency: o.urgency,
        branch: o.branch?.name ?? '',
        total: Number(o.total),
        paid: Number(o.paid),
        debt: Number(o.balanceDue),
        returned: Number(o.returnedTotal),
        deadline: o.deadline,
        overdue,
        daysToDeadline: o.deadline
          ? Math.ceil((o.deadline.getTime() - now.getTime()) / dayMs)
          : null,
      };
    });

    return {
      count: items.length,
      totals: {
        total: this.round2(total),
        paid: this.round2(paid),
        debt: this.round2(debt),
        returned: this.round2(returned),
      },
      items,
    };
  }

  // ======================================================================
  // helpers
  // ======================================================================

  // Диапазон дат: по умолчанию — текущий месяц. Границы включительные.
  private range(from?: string, to?: string): { gte: Date; lte: Date } {
    let gte: Date;
    if (from) {
      gte = new Date(from);
    } else {
      gte = new Date();
      gte.setDate(1);
    }
    gte.setHours(0, 0, 0, 0);
    const lte = to ? new Date(to) : new Date();
    lte.setHours(23, 59, 59, 999);
    return { gte, lte };
  }

  // Предыдущий период той же длины — сразу перед gte
  private prevRange(range: { gte: Date; lte: Date }): { gte: Date; lte: Date } {
    const durationMs = range.lte.getTime() - range.gte.getTime();
    const prevLte = new Date(range.gte.getTime() - 1);
    const prevGte = new Date(prevLte.getTime() - durationMs);
    return { gte: prevGte, lte: prevLte };
  }

  private dayKey(d: Date) {
    // Локальная дата YYYY-MM-DD. Границы периода и бакетов тоже строятся в
    // локальном времени (setHours/getDate), поэтому ключи/подписи не «сползают»
    // на день в поясах ≠ UTC (Таджикистан = UTC+5).
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private round2(n: number) {
    return Number((n || 0).toFixed(2));
  }
  private round1(n: number) {
    return Number((n || 0).toFixed(1));
  }
  private round3(n: number) {
    return Number((n || 0).toFixed(3));
  }

  private pctDelta(cur: number, prev: number): number {
    if (!prev) return cur ? 100 : 0;
    return this.round1(((cur - prev) / Math.abs(prev)) * 100);
  }

  // Оплаты по методам за период (с учётом филиала через order.branchId)
  private async paymentsByMethod(
    companyId: string,
    range: { gte: Date; lte: Date },
    branchId?: string,
  ) {
    const payments = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        companyId,
        createdAt: range,
        ...(branchId ? { order: { branchId } } : {}),
      },
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
      byMethod[p.method] = this.round2(Number(p._sum.amount ?? 0));
    }
    return byMethod;
  }

  // Сумма расходов кассы (OUT, кроме «Возвраты») за период
  private async expensesTotal(
    companyId: string,
    range: { gte: Date; lte: Date },
    branchId?: string,
  ) {
    const agg = await this.prisma.cashMovement.aggregate({
      where: {
        companyId,
        type: 'OUT',
        createdAt: range,
        NOT: { category: 'Возвраты' },
        ...(branchId ? { shift: { branchId } } : {}),
      },
      _sum: { amount: true },
    });
    return this.round2(Number(agg._sum.amount ?? 0));
  }

  // Бакеты периода по группировке day|week|month (пустые тоже присутствуют)
  private isSupplierExpenseCategory(category?: string | null) {
    const normalized = (category ?? '').trim().toLocaleLowerCase('ru-RU');
    return normalized.includes(
      '\u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a',
    );
  }

  private buildBuckets(
    range: { gte: Date; lte: Date },
    groupBy: 'day' | 'week' | 'month',
  ) {
    const buckets: {
      key: string;
      label: string;
      collected: number;
      billed: number;
      ordersCount: number;
      profit: number;
    }[] = [];
    const cursor = this.bucketStart(new Date(range.gte), groupBy);
    while (cursor <= range.lte) {
      const key = this.dayKey(cursor);
      buckets.push({
        key,
        label: this.bucketLabel(cursor, groupBy),
        collected: 0,
        billed: 0,
        ordersCount: 0,
        profit: 0,
      });
      this.advanceBucket(cursor, groupBy);
    }
    return buckets;
  }

  // Начало бакета, к которому относится дата
  private bucketStart(d: Date, groupBy: 'day' | 'week' | 'month'): Date {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    if (groupBy === 'week') {
      // Неделя с понедельника
      const day = (r.getDay() + 6) % 7;
      r.setDate(r.getDate() - day);
    } else if (groupBy === 'month') {
      r.setDate(1);
    }
    return r;
  }

  private advanceBucket(cursor: Date, groupBy: 'day' | 'week' | 'month') {
    if (groupBy === 'day') cursor.setDate(cursor.getDate() + 1);
    else if (groupBy === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }

  // Ключ бакета для конкретной даты (совпадает с key из buildBuckets)
  private bucketKey(d: Date, groupBy: 'day' | 'week' | 'month'): string {
    return this.dayKey(this.bucketStart(d, groupBy));
  }

  private bucketLabel(d: Date, groupBy: 'day' | 'week' | 'month'): string {
    if (groupBy === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return this.dayKey(d);
  }
}
