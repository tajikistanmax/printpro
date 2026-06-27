import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ItemType,
  OrderStatus,
  OrderType,
  PaymentStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { TelegramService } from '../telegram/telegram.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AddPaymentDto, QuickSaleDto } from './dto/order-actions.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly telegram: TelegramService,
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

    // 2. Считаем суммы по позициям
    const items = dto.items.map((it) => ({
      ...it,
      lineTotal: Number((it.quantity * it.unitPrice).toFixed(2)),
    }));
    const total = Number(
      items.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2),
    );

    // 3. Всё в одной транзакции (либо всё, либо ничего)
    return this.prisma.$transaction(async (tx) => {
      // Номер заказа: ORD-ГОД-NNNNNN (порядковый внутри компании)
      const count = await tx.order.count({ where: { companyId: dto.companyId } });
      const year = new Date().getFullYear();
      const seq = String(count + 1).padStart(6, '0');
      const orderNumber = `ORD-${year}-${seq}`;

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
              options: it.options ?? undefined,
              lineTotal: it.lineTotal,
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
    if (dto.discount && dto.discount > 0) {
      total = Math.max(0, Number((total - dto.discount).toFixed(2)));
      await this.prisma.order.update({
        where: { id: order.id },
        data: { total, balanceDue: total },
      });
    }

    // Оплата на всю сумму (если есть что платить)
    if (total > 0) {
      await this.addPayment(order.id, { amount: total, method: dto.method }, userId);
    } else {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { paid: 0, balanceDue: 0, paymentStatus: PaymentStatus.PAID },
      });
    }

    // Продажа = сразу выдана
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DELIVERED },
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
  findAll(companyId: string, status?: OrderStatus) {
    return this.prisma.order.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: { client: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
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
        items: { include: { service: true, product: true } },
        payments: true,
        repairDetail: true,
        recoveryDetail: true,
        files: true,
        assignedUser: { select: { id: true, fullName: true } },
      },
    });
  }
}
