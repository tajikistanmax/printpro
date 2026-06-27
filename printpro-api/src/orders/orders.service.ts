import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ItemType,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { TelegramService } from '../telegram/telegram.service';
import { docNumber } from '../common/doc-number';
import { CreateOrderDto } from './dto/create-order.dto';
import { AddPaymentDto, QuickSaleDto } from './dto/order-actions.dto';
import { PromocodesService } from '../promocodes/promocodes.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly telegram: TelegramService,
    private readonly promocodes: PromocodesService,
  ) {}

  // ---------- Создание заказа ----------
  async create(dto: CreateOrderDto) {
    // 1. Клиент: по id или по телефону (найдём/создадим)
    let clientId = dto.clientId;
    if (!clientId && dto.clientPhone) {
      const client = await this.clients.findOrCreate(
        dto.companyId,
        dto.clientPhone,
        dto.clientName,
      );
      clientId = client.id;
    }

    // 2. Себестоимость услуг — подставим из справочника, если не передана
    const serviceIds = dto.items
      .filter((it) => it.serviceId)
      .map((it) => it.serviceId!);
    const serviceCosts = serviceIds.length
      ? new Map(
          (
            await this.prisma.service.findMany({
              where: { id: { in: serviceIds } },
              select: { id: true, costPrice: true },
            })
          ).map((s) => [s.id, Number(s.costPrice)]),
        )
      : new Map<string, number>();

    // Считаем суммы и себестоимость по позициям
    const items = dto.items.map((it) => {
      const unitCost =
        it.unitCost ??
        (it.serviceId ? serviceCosts.get(it.serviceId) ?? 0 : 0);
      return {
        ...it,
        unitCost,
        lineTotal: Number((it.quantity * it.unitPrice).toFixed(2)),
        lineCost: Number((it.quantity * unitCost).toFixed(2)),
      };
    });
    const total = Number(
      items.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2),
    );

    // 2.5. Кредитный лимит клиента (п. 8.4 ТЗ): если долг + новый заказ превышают лимит — блок
    if (clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: { creditLimit: true, fullName: true },
      });
      const limit = Number(client?.creditLimit ?? 0);
      if (limit > 0) {
        const agg = await this.prisma.order.aggregate({
          where: { clientId, status: { not: OrderStatus.CANCELLED } },
          _sum: { balanceDue: true },
        });
        const currentDebt = Number(agg._sum.balanceDue ?? 0);
        if (currentDebt + total > limit) {
          throw new BadRequestException(
            `Превышен кредитный лимит клиента (${limit} c.). Текущий долг ${currentDebt} c. + заказ ${total} c.`,
          );
        }
      }
    }

    // 3. Всё в одной транзакции (либо всё, либо ничего)
    return this.prisma.$transaction(async (tx) => {
      // Номер заказа: ORD-<УЗЕЛ>-ГОД-NNNNNN.
      // Префикс узла (NODE_ID) гарантирует уникальность между точками сети.
      const node = (process.env.NODE_ID ?? 'C').toUpperCase();
      const count = await tx.order.count({ where: { companyId: dto.companyId } });
      const year = new Date().getFullYear();
      const seq = String(count + 1).padStart(6, '0');
      const orderNumber = `ORD-${node}-${year}-${seq}`;

      // Создаём заказ с позициями
      const order = await tx.order.create({
        data: {
          companyId: dto.companyId,
          branchId: dto.branchId,
          orderNumber,
          clientId,
          orderType: dto.orderType,
          assignedUserId: dto.assignedUserId,
          createdById: dto.createdById,
          designerId: dto.designerId,
          operatorId: dto.operatorId,
          format: dto.format,
          colorMode: dto.colorMode,
          urgency: dto.urgency,
          deadline: dto.deadline ? new Date(dto.deadline) : undefined,
          note: dto.note,
          total,
          paid: 0,
          balanceDue: total,
          paymentStatus: PaymentStatus.UNPAID,
          items: {
            create: items.map((it) => ({
              itemType: it.itemType,
              serviceId: it.serviceId,
              productId: it.productId,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              unitCost: it.unitCost,
              options: it.options ?? undefined,
              lineTotal: it.lineTotal,
              lineCost: it.lineCost,
            })),
          },
          repairDetail: dto.repairDetail
            ? { create: dto.repairDetail }
            : undefined,
          recoveryDetail: dto.recoveryDetail
            ? { create: dto.recoveryDetail }
            : undefined,
        },
      });

      // 4. Списываем товары со склада (если просили и есть филиал)
      if (dto.decrementStock && dto.branchId) {
        for (const it of items) {
          if (it.itemType === ItemType.PRODUCT && it.productId) {
            const stock = await tx.stock.findUnique({
              where: {
                productId_branchId: {
                  productId: it.productId,
                  branchId: dto.branchId,
                },
              },
            });
            const available = stock ? Number(stock.quantity) : 0;
            if (available < it.quantity) {
              throw new BadRequestException(
                `Недостаточно товара на складе (нужно ${it.quantity}, есть ${available})`,
              );
            }
            await tx.stock.update({
              where: {
                productId_branchId: {
                  productId: it.productId,
                  branchId: dto.branchId,
                },
              },
              data: { quantity: { decrement: it.quantity } },
            });
            await tx.stockMovement.create({
              data: {
                companyId: dto.companyId,
                productId: it.productId,
                branchId: dto.branchId,
                type: StockMovementType.OUT,
                quantity: it.quantity,
                reason: `Продажа по заказу №${orderNumber}`,
                orderId: order.id,
              },
            });
          }
        }
      }

      return this.loadFull(tx, order.id);
    });
  }

  // ---------- Добавить оплату (касса) ----------
  // userId — кассир из токена; если смена не указана явно, привязываем
  // оплату к его текущей открытой смене, чтобы она попала в отчёт кассы.
  async addPayment(orderId: string, dto: AddPaymentDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Заказ не найден');

      const cashierId = userId ?? dto.userId;

      // Привязка к открытой смене: явный shiftId или текущая смена кассира
      let shiftId = dto.shiftId;
      if (!shiftId && cashierId) {
        const openShift = await tx.cashShift.findFirst({
          where: { companyId: order.companyId, userId: cashierId, closedAt: null },
        });
        shiftId = openShift?.id;
      }

      await tx.payment.create({
        data: {
          companyId: order.companyId,
          orderId,
          amount: dto.amount,
          method: dto.method,
          userId: cashierId,
          shiftId,
        },
      });

      const newPaid = Number(order.paid) + dto.amount;
      const balanceDue = Number((Number(order.total) - newPaid).toFixed(2));

      // Статус оплаты
      let paymentStatus: PaymentStatus;
      if (balanceDue <= 0) paymentStatus = PaymentStatus.PAID;
      else if (newPaid > 0) paymentStatus = PaymentStatus.PARTIAL;
      else paymentStatus = PaymentStatus.UNPAID;

      await tx.order.update({
        where: { id: orderId },
        data: {
          paid: newPaid,
          balanceDue: balanceDue < 0 ? 0 : balanceDue,
          paymentStatus,
        },
      });

      // Бонусы клиенту: 1% от внесённой суммы (п. 8.6), кроме оплаты «в долг»
      if (order.clientId && dto.method !== PaymentMethod.DEBT) {
        const bonus = Number((dto.amount * 0.01).toFixed(2));
        if (bonus > 0) {
          await tx.client.update({
            where: { id: order.clientId },
            data: { bonusPoints: { increment: bonus } },
          });
        }
      }

      return this.loadFull(tx, orderId);
    });
  }

  // ---------- Быстрая продажа (POS) ----------
  // Создаёт заказ-продажу, сразу оплачивает и помечает выданным.
  async quickSale(dto: QuickSaleDto, userId?: string) {
    const order = await this.create({
      companyId: dto.companyId,
      branchId: dto.branchId,
      orderType: OrderType.SALE,
      clientPhone: dto.clientPhone,
      clientName: dto.clientName,
      createdById: userId,
      decrementStock: true,
      items: dto.items,
    });

    // Скидка (абсолютная) — уменьшаем итог
    let total = Number(order.total);
    let discount = dto.discount && dto.discount > 0 ? dto.discount : 0;

    // Промокод (п. 8.7) — добавляем к скидке
    if (dto.promoCode) {
      const promoDisc = await this.promocodes.consume(
        dto.companyId,
        dto.promoCode,
        total,
      );
      discount += promoDisc;
    }

    // Списание бонусов (п. 8.6) — не более 30% от суммы и не больше остатка бонусов
    let bonusUsed = 0;
    if (dto.useBonus && dto.useBonus > 0 && order.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: order.clientId },
        select: { bonusPoints: true },
      });
      const maxByPercent = Number((total * 0.3).toFixed(2));
      bonusUsed = Math.min(
        dto.useBonus,
        Number(client?.bonusPoints ?? 0),
        maxByPercent,
      );
      bonusUsed = Number(bonusUsed.toFixed(2));
      if (bonusUsed > 0) {
        discount += bonusUsed;
        await this.prisma.client.update({
          where: { id: order.clientId },
          data: { bonusPoints: { decrement: bonusUsed } },
        });
      }
    }

    if (discount > 0) {
      total = Math.max(0, Number((total - discount).toFixed(2)));
      await this.prisma.order.update({
        where: { id: order.id },
        data: { total, balanceDue: total },
      });
    }

    // Оплата: смешанная (несколько способов) или одним способом
    if (total > 0) {
      const parts =
        dto.payments && dto.payments.length > 0
          ? dto.payments
          : [{ method: dto.method ?? PaymentMethod.CASH, amount: total }];
      for (const part of parts) {
        if (part.amount > 0) {
          await this.addPayment(
            order.id,
            { amount: part.amount, method: part.method },
            userId,
          );
        }
      }
    } else {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { paid: 0, balanceDue: 0, paymentStatus: PaymentStatus.PAID },
      });
    }

    // Продажа = сразу выдана + номер чека POS-...
    const posCount = await this.prisma.order.count({
      where: { companyId: dto.companyId, receiptNumber: { not: null } },
    });
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.DELIVERED,
        receiptNumber: docNumber('POS', posCount + 1, 5),
      },
    });

    return this.findOne(order.id);
  }

  // ---------- Возврат заказа ----------
  // Отменяет заказ, возвращает деньги из кассы и возвращает товар на склад.
  async refund(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Заказ уже отменён');
      }

      const paid = Number(order.paid);

      // 1. Возврат денег из кассы (расход)
      if (paid > 0) {
        await tx.cashMovement.create({
          data: {
            companyId: order.companyId,
            type: 'OUT',
            amount: paid,
            reason: `Возврат по заказу №${order.orderNumber}`,
          },
        });
      }

      // 2. Возврат товаров на склад
      if (order.branchId) {
        for (const it of order.items) {
          if (it.itemType === ItemType.PRODUCT && it.productId) {
            await tx.stock.upsert({
              where: {
                productId_branchId: {
                  productId: it.productId,
                  branchId: order.branchId,
                },
              },
              create: {
                productId: it.productId,
                branchId: order.branchId,
                quantity: it.quantity,
              },
              update: { quantity: { increment: it.quantity } },
            });
            await tx.stockMovement.create({
              data: {
                companyId: order.companyId,
                productId: it.productId,
                branchId: order.branchId,
                type: StockMovementType.IN,
                quantity: it.quantity,
                reason: `Возврат по заказу №${order.orderNumber}`,
                orderId: order.id,
              },
            });
          }
        }
      }

      // 3. Помечаем заказ отменённым
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      return this.loadFull(tx, orderId);
    });
  }

  // ---------- Повторить заказ ----------
  // Создаёт новый заказ-копию по позициям и характеристикам существующего.
  async reorder(orderId: string) {
    const src = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!src) throw new NotFoundException('Заказ не найден');

    return this.create({
      companyId: src.companyId,
      branchId: src.branchId ?? undefined,
      orderType: src.orderType,
      clientId: src.clientId ?? undefined,
      assignedUserId: src.assignedUserId ?? undefined,
      designerId: src.designerId ?? undefined,
      operatorId: src.operatorId ?? undefined,
      format: src.format ?? undefined,
      colorMode: src.colorMode ?? undefined,
      urgency: src.urgency,
      note: src.note ?? undefined,
      items: src.items.map((it) => ({
        itemType: it.itemType,
        serviceId: it.serviceId ?? undefined,
        productId: it.productId ?? undefined,
        description: it.description ?? undefined,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        unitCost: Number(it.unitCost),
        options: it.options ?? undefined,
      })),
    });
  }

  // ---------- Сменить статус ----------
  async updateStatus(orderId: string, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    await this.prisma.order.update({ where: { id: orderId }, data: { status } });

    // Уведомление в Telegram о готовности заказа
    if (status === OrderStatus.READY) {
      void this.telegram.send(
        order.companyId,
        `✅ Заказ №${order.orderNumber} готов к выдаче`,
      );
    }

    return this.findOne(orderId);
  }

  // ---------- Списки и чтение ----------
  async findAll(
    companyId: string,
    status?: OrderStatus,
    page = 1,
    pageSize = 25,
    search?: string,
  ) {
    const where: Prisma.OrderWhereInput = {
      companyId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: 'insensitive' } },
              { client: { fullName: { contains: search, mode: 'insensitive' } } },
              { client: { phone: { contains: search } } },
            ],
          }
        : {}),
    };
    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { client: true, items: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), pageSize: take };
  }

  async findOne(id: string) {
    const order = await this.loadFull(this.prisma, id);
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  // Долги: заказы с непогашенным остатком
  async debts(companyId: string) {
    const orders = await this.prisma.order.findMany({
      where: { companyId, balanceDue: { gt: new Prisma.Decimal(0) } },
      include: { client: true },
      orderBy: { createdAt: 'asc' },
    });
    return orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
      phone: o.client?.phone ?? '',
      total: Number(o.total),
      paid: Number(o.paid),
      debt: Number(o.balanceDue),
    }));
  }

  // Загрузка заказа со всеми связями
  private loadFull(db: Prisma.TransactionClient | PrismaService, id: string) {
    return (db as any).order.findUnique({
      where: { id },
      include: {
        client: true,
        items: {
          include: {
            service: {
              include: { materials: { include: { product: { include: { unit: true } } } } },
            },
            product: { include: { unit: true } },
          },
        },
        payments: true,
        repairDetail: true,
        recoveryDetail: true,
        files: true,
        assignedUser: { select: { id: true, fullName: true } },
        designer: { select: { id: true, fullName: true } },
        operator: { select: { id: true, fullName: true } },
      },
    });
  }
}
