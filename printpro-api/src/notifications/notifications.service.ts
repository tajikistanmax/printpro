import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, ProofStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface Notification {
  type: string;
  level: 'info' | 'warning' | 'danger';
  title: string;
  link: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string): Promise<Notification[]> {
    const out: Notification[] = [];

    // Тумблеры уведомлений из настроек. По умолчанию (ключ не задан) — ВКЛ;
    // выключено только при явном значении 'false' (совпадает с тумблерами в UI).
    const settings = await this.prisma.setting.findMany({
      where: {
        companyId,
        key: { in: ['notifyLowStock', 'notifyDebts', 'notifyOrderReady'] },
      },
    });
    const enabled = (key: string) =>
      settings.find((s) => s.key === key)?.value !== 'false';
    const notifyLow = enabled('notifyLowStock');
    const notifyDebts = enabled('notifyDebts');
    const notifyReady = enabled('notifyOrderReady');

    // 1. Низкий остаток на складе
    if (notifyLow) {
      const stocks = await this.prisma.stock.findMany({
        where: { product: { companyId, minStock: { gt: new Prisma.Decimal(0) } } },
        include: { product: { select: { name: true, minStock: true } } },
      });
      const lowList = stocks.filter(
        (s) => Number(s.quantity) <= Number(s.product.minStock),
      );
      for (const s of lowList.slice(0, 10)) {
        out.push({
          type: 'low_stock',
          level: 'warning',
          title: `Мало на складе: ${s.product.name} (${Number(s.quantity)})`,
          link: '/warehouse',
        });
      }
    }

    // 2. Долги клиентов (отменённые заказы в долг не считаем)
    const debt = await this.prisma.order.aggregate({
      where: {
        companyId,
        status: { not: OrderStatus.CANCELLED },
        balanceDue: { gt: new Prisma.Decimal(0) },
      },
      _sum: { balanceDue: true },
      _count: true,
    });
    if (notifyDebts && debt._count > 0) {
      out.push({
        type: 'debts',
        level: 'warning',
        title: `Долги клиентов: ${debt._count} на ${Number(debt._sum.balanceDue ?? 0)} c.`,
        link: '/debts',
      });
    }

    // 2b. Просроченные долги (срок погашения прошёл, остаток не погашен).
    // Просрочка считается только со следующего дня после срока (не в течение дня).
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const overdue = await this.prisma.order.aggregate({
      where: {
        companyId,
        status: { not: OrderStatus.CANCELLED },
        balanceDue: { gt: new Prisma.Decimal(0) },
        debtDueDate: { lt: startOfToday },
      },
      _sum: { balanceDue: true },
      _count: true,
    });
    if (notifyDebts && overdue._count > 0) {
      out.push({
        type: 'debts_overdue',
        level: 'danger',
        title: `Просроченные долги: ${overdue._count} на ${Number(overdue._sum.balanceDue ?? 0)} c.`,
        link: '/debts',
      });
    }

    // 3. Срочные заказы (дедлайн в ближайшие 2 дня)
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 2);
    const urgent = await this.prisma.order.count({
      where: {
        companyId,
        deadline: { lte: soonDate, gte: new Date() },
        status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] },
      },
    });
    if (urgent > 0) {
      out.push({
        type: 'urgent',
        level: 'danger',
        title: `Срочные заказы: ${urgent} с близким сроком`,
        link: '/orders',
      });
    }

    // 4. Макеты, требующие внимания
    const revision = await this.prisma.designProof.count({
      where: { companyId, status: ProofStatus.REVISION },
    });
    if (revision > 0) {
      out.push({
        type: 'proof_revision',
        level: 'warning',
        title: `Макеты на правке: ${revision}`,
        link: '/design',
      });
    }

    // 5. Заказы, готовые к выдаче
    const ready = await this.prisma.order.count({
      where: { companyId, status: OrderStatus.READY },
    });
    if (notifyReady && ready > 0) {
      out.push({
        type: 'ready',
        level: 'info',
        title: `Готовы к выдаче: ${ready}`,
        link: '/orders',
      });
    }

    return out;
  }
}
