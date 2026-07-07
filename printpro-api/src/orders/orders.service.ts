import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscountType,
  ItemType,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { docNumber } from '../common/doc-number';
import { nextSeq } from '../common/next-number';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  AddPaymentDto,
  QuickSaleDto,
  HoldSaleDto,
  CreateReturnDto,
} from './dto/order-actions.dto';
import { PromocodesService } from '../promocodes/promocodes.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import * as OrderMath from './order-math';

function normalizeClientPhone(phone: string): string {
  return (phone ?? '').replace(/[\s()-]/g, '');
}

// Фильтры для списка заказов и сводки (страница «Заказы»).
export interface OrderFilters {
  status?: OrderStatus;
  orderType?: OrderType;
  managerId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly promocodes: PromocodesService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Создание заказа ----------
  async create(dto: CreateOrderDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Идемпотентность (finding 58): повтор с тем же ключом (двойной клик/ретрай)
        // возвращает уже созданный заказ, а не бросает сырой P2002/500 — как в quickSale.
        if (dto.idempotencyKey) {
          const existing = await tx.order.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          });
          if (existing && existing.status !== OrderStatus.CANCELLED) {
            return this.loadFull(tx, existing.id);
          }
        }
        return this.createOrderTx(tx, dto);
      });
    } catch (e: any) {
      // Гонка: параллельный запрос с тем же ключом создал заказ первым —
      // отдаём его вместо ошибки уникальности (finding 58).
      if (e?.code === 'P2002' && dto.idempotencyKey) {
        const existing = await this.prisma.order.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing && existing.status !== OrderStatus.CANCELLED) {
          return this.findOne(existing.id);
        }
      }
      throw e;
    }
  }

  private async createOrderTx(
    tx: Prisma.TransactionClient,
    dto: CreateOrderDto,
  ) {
    // 1. Клиент: по id или по телефону (найдём/создадим)
    let clientId = dto.clientId;
    if (!clientId && dto.clientPhone) {
      const phone = normalizeClientPhone(dto.clientPhone);
      const client =
        (await tx.client.findFirst({
          where: { companyId: dto.companyId, phone, deletedAt: null },
        })) ??
        (await tx.client.create({
          data: { companyId: dto.companyId, phone, fullName: dto.clientName },
        }));
      clientId = client.id;
    }

    // 2. Себестоимость услуг — подставим из справочника, если не передана
    const serviceIds = dto.items
      .filter((it) => it.serviceId)
      .map((it) => it.serviceId!);
    const serviceCosts = serviceIds.length
      ? new Map(
          (
            await tx.service.findMany({
              where: {
                id: { in: serviceIds },
                companyId: dto.companyId,
                deletedAt: null,
              },
              select: { id: true, costPrice: true },
            })
          ).map((s) => [s.id, Number(s.costPrice)]),
        )
      : new Map<string, number>();

    // Себестоимость товаров — из закупочной цены, если не передана
    const productIds = dto.items
      .filter((it) => it.productId)
      .map((it) => it.productId!);
    const productCosts = productIds.length
      ? new Map(
          (
            await tx.product.findMany({
              where: {
                id: { in: productIds },
                companyId: dto.companyId,
                deletedAt: null,
              },
              select: { id: true, purchasePrice: true },
            })
          ).map((p) => [p.id, Number(p.purchasePrice)]),
        )
      : new Map<string, number>();

    // Считаем суммы и себестоимость по позициям
    const items = dto.items.map((it) => {
      const unitCost =
        it.unitCost ??
        (it.serviceId
          ? (serviceCosts.get(it.serviceId) ?? 0)
          : it.productId
            ? (productCosts.get(it.productId) ?? 0)
            : 0);
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

    // 3. Всё в одной транзакции (либо всё, либо ничего)
    // 2.5. Кредитный лимит клиента (п. 8.4 ТЗ): если долг + новый заказ
    // превышают лимит — блок. Проверяем ВНУТРИ транзакции (не до неё), чтобы
    // два параллельных заказа не проскочили лимит по отдельности.
    if (clientId) {
      const client = await tx.client.findUnique({
        where: { id: clientId },
        select: { creditLimit: true },
      });
      const limit = Number(client?.creditLimit ?? 0);
      if (limit > 0) {
        const agg = await tx.order.aggregate({
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

    // Необязательные настройки заказов: префикс номера и срок по умолчанию.
    const orderSettings = await tx.setting.findMany({
      where: {
        companyId: dto.companyId,
        key: { in: ['orderPrefix', 'orderDefaultLeadDays'] },
      },
    });
    const settingMap: Record<string, string> = {};
    for (const r of orderSettings) settingMap[r.key] = r.value ?? '';
    const prefix =
      (settingMap.orderPrefix || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase() || 'ORD';
    const leadDays = Number(settingMap.orderDefaultLeadDays || 0);

    // Номер заказа: <ПРЕФИКС>-<УЗЕЛ>-ГОД-NNNNNN.
    // Префикс узла (NODE_ID) гарантирует уникальность между точками сети.
    const node = (process.env.NODE_ID ?? 'C').toUpperCase();
    const year = new Date().getFullYear();
    const seq = String(await nextSeq(tx, dto.companyId, 'ORDER')).padStart(
      6,
      '0',
    );
    const orderNumber = `${prefix}-${node}-${year}-${seq}`;

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
        deadline: dto.deadline
          ? new Date(dto.deadline)
          : leadDays > 0
            ? new Date(Date.now() + leadDays * 86400000)
            : undefined,
        debtDueDate: dto.debtDueDate ? new Date(dto.debtDueDate) : undefined,
        note: dto.note,
        idempotencyKey: dto.idempotencyKey,
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
        statusHistory: {
          create: { status: OrderStatus.ACCEPTED, userId: dto.createdById },
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
          // Условное списание: уменьшаем остаток только если его хватает.
          // Атомарно (одним UPDATE ... WHERE quantity >= n), поэтому два
          // одновременных кассира не уведут остаток в минус.
          const dec = await tx.stock.updateMany({
            where: {
              productId: it.productId,
              branchId: dto.branchId,
              quantity: { gte: it.quantity },
            },
            data: { quantity: { decrement: it.quantity } },
          });
          if (dec.count === 0) {
            const cur = await tx.stock.findUnique({
              where: {
                productId_branchId: {
                  productId: it.productId,
                  branchId: dto.branchId,
                },
              },
            });
            const available = cur ? Number(cur.quantity) : 0;
            throw new BadRequestException(
              `Недостаточно товара на складе (нужно ${it.quantity}, есть ${available})`,
            );
          }
          const after = await tx.stock.findUnique({
            where: {
              productId_branchId: {
                productId: it.productId,
                branchId: dto.branchId,
              },
            },
          });
          const afterQty = after ? Number(after.quantity) : 0;
          await tx.stockMovement.create({
            data: {
              companyId: dto.companyId,
              productId: it.productId,
              branchId: dto.branchId,
              type: StockMovementType.OUT,
              quantity: it.quantity,
              beforeQty: Number((afterQty + it.quantity).toFixed(3)),
              afterQty,
              reason: `Продажа по заказу №${orderNumber}`,
              orderId: order.id,
            },
          });
        }
      }
    }

    return this.loadFull(tx, order.id);
  }

  // ---------- Добавить оплату (касса) ----------
  // userId — кассир из токена; если смена не указана явно, привязываем
  // оплату к его текущей открытой смене, чтобы она попала в отчёт кассы.
  async addPayment(
    orderId: string,
    dto: AddPaymentDto,
    userId?: string,
    companyId?: string,
  ) {
    // «В долг» — это НЕ внесение денег: такой платёж нельзя проводить как оплату,
    // иначе paid вырастет и заказ станет PAID без реальных денег (долг «испарится»).
    // Долговая продажа оформляется отдельным сценарием в quickSale.
    if (dto.method === PaymentMethod.DEBT) {
      throw new BadRequestException(
        'Способ «В долг» нельзя провести как оплату — заказ остаётся долгом',
      );
    }
    return this.prisma.$transaction((tx) =>
      this.addPaymentTx(tx, orderId, dto, userId, companyId),
    );
  }

  private async addPaymentTx(
    tx: Prisma.TransactionClient,
    orderId: string,
    dto: AddPaymentDto,
    userId?: string,
    companyId?: string,
  ) {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (companyId && order.companyId !== companyId) {
      throw new NotFoundException('Заказ не найден');
    }

    // Защита от переплаты: нельзя внести больше, чем осталось к оплате.
    // Долговая оплата (method DEBT) здесь не проводится — это отдельный сценарий POS.
    // Эффективный итог = total − возвращённое: после частичного возврата к оплате
    // остаётся меньше, иначе разрешалась бы переплата и заказ не стал бы PAID (P0-3).
    const effTotal = OrderMath.effectiveTotal(
      Number(order.total),
      Number(order.returnedTotal),
    );
    const balanceBefore = Number((effTotal - Number(order.paid)).toFixed(2));
    if (balanceBefore <= 0) {
      throw new BadRequestException('Заказ уже полностью оплачен');
    }
    if (dto.amount > balanceBefore + 0.01) {
      throw new BadRequestException(
        `Сумма оплаты (${dto.amount} c.) превышает остаток к оплате (${balanceBefore} c.)`,
      );
    }

    const cashierId = userId ?? dto.userId;

    // Привязка к открытой смене: явный shiftId или текущая смена кассира
    let shiftId = dto.shiftId;
    if (!shiftId && cashierId) {
      const openShift = await tx.cashShift.findFirst({
        where: {
          companyId: order.companyId,
          userId: cashierId,
          closedAt: null,
          deletedAt: null,
        },
      });
      shiftId = openShift?.id;
    }
    if (shiftId) {
      const shift = await tx.cashShift.findFirst({
        where: {
          id: shiftId,
          companyId: order.companyId,
          closedAt: null,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!shift) throw new BadRequestException('Open cash shift not found');
    } else {
      throw new BadRequestException('Open a cash shift before payment');
    }

    const newPaid = Number((Number(order.paid) + dto.amount).toFixed(2));
    const balanceDue = Number((effTotal - newPaid).toFixed(2));

    // Статус оплаты
    const paymentStatus = OrderMath.paymentStatusFor(newPaid, balanceDue);

    // Оптимистичная блокировка: обновляем заказ только если `paid` не изменился
    // с момента чтения. Иначе два параллельных запроса (двойной клик) прочитали бы
    // один и тот же остаток и создали переплату. Здесь второй запрос получит count=0.
    const upd = await tx.order.updateMany({
      where: { id: orderId, paid: order.paid },
      data: {
        paid: newPaid,
        balanceDue: balanceDue < 0 ? 0 : balanceDue,
        paymentStatus,
      },
    });
    if (upd.count === 0) {
      throw new BadRequestException(
        'Оплата не проведена: заказ изменился (возможно, оплачен параллельно). Обновите и повторите.',
      );
    }

    // Платёж создаём только после успешного обновления — иначе остался бы «висящий» платёж.
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

    // Аудит оплаты заказа со снимком paid/balanceDue/статуса (P1-9d)
    await this.audit.recordTx(tx, {
      companyId: order.companyId,
      userId: cashierId,
      action: 'money:payment',
      entity: 'order',
      entityId: orderId,
      before: {
        paid: Number(order.paid),
        balanceDue: Number(order.balanceDue),
        paymentStatus: order.paymentStatus,
      },
      after: {
        paid: newPaid,
        balanceDue: balanceDue < 0 ? 0 : balanceDue,
        paymentStatus,
        amount: dto.amount,
        method: dto.method,
        shiftId,
      },
    });

    return this.loadFull(tx, orderId);
  }

  // ---------- Быстрая продажа (POS) ----------
  // Создаёт заказ-продажу, сразу оплачивает и помечает выданным.
  private calcPromoDiscount(
    discountType: DiscountType,
    value: number,
    subtotal: number,
  ) {
    if (discountType === DiscountType.PERCENT) {
      const percent = Math.min(value, 100);
      return Math.min(
        Number(((subtotal * percent) / 100).toFixed(2)),
        subtotal,
      );
    }
    return Math.min(value, subtotal);
  }

  private async consumePromoTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    code: string,
    subtotal: number,
  ) {
    const normalizedCode = code.trim().toUpperCase();
    const promo = await tx.promoCode.findFirst({
      where: { companyId, code: normalizedCode, deletedAt: null },
    });
    if (!promo || !promo.isActive) {
      throw new BadRequestException('Promocode not found');
    }
    if (promo.validUntil && promo.validUntil.getTime() < Date.now()) {
      throw new BadRequestException('Promocode expired');
    }
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      throw new BadRequestException('Promocode usage limit reached');
    }

    const { count } = await tx.promoCode.updateMany({
      where: {
        id: promo.id,
        companyId,
        deletedAt: null,
        isActive: true,
        usedCount: promo.usedCount,
      },
      data: { usedCount: { increment: 1 } },
    });
    if (count === 0) {
      throw new BadRequestException('Promocode unavailable');
    }

    return this.calcPromoDiscount(
      promo.discountType,
      Number(promo.value),
      subtotal,
    );
  }

  async quickSale(dto: QuickSaleDto, userId?: string) {
    const hasProducts = (dto.items ?? []).some(
      (i) => i.itemType === ItemType.PRODUCT || !!i.productId,
    );
    if (hasProducts && !dto.branchId) {
      throw new BadRequestException('Select a branch before selling products');
    }

    const isDebtSale =
      dto.method === PaymentMethod.DEBT &&
      (!dto.payments || dto.payments.length === 0);
    if (isDebtSale && !dto.clientPhone?.trim()) {
      throw new BadRequestException('Client is required for debt sale');
    }

    if (dto.payments?.some((p) => p.method === PaymentMethod.DEBT)) {
      throw new BadRequestException(
        'Debt cannot be used as part of mixed payment',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.idempotencyKey) {
          const existing = await tx.order.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          });
          if (existing && existing.status !== OrderStatus.CANCELLED) {
            return this.loadFull(tx, existing.id);
          }
        }

        const order = await this.createOrderTx(tx, {
          companyId: dto.companyId,
          branchId: dto.branchId,
          orderType: OrderType.SALE,
          clientPhone: dto.clientPhone,
          clientName: dto.clientName,
          createdById: userId,
          decrementStock: true,
          idempotencyKey: dto.idempotencyKey,
          note: dto.note,
          debtDueDate: dto.debtDueDate,
          items: dto.items,
        });
        if (!order) throw new BadRequestException('Order was not created');

        let total = Number(order.total);
        // Скидки применяются ПОСЛЕДОВАТЕЛЬНО к остатку (как на фронте POS:
        // ручная → промокод → бонусы), каждая ограничена остатком. Если остаток
        // уже обнулён предыдущей скидкой, промокод НЕ расходуется и бонусы НЕ
        // списываются — иначе зря сгорел бы промокод и пропали бы баллы (finding 601).
        let discount = 0;
        let remaining = total;

        const manual = Math.min(
          dto.discount && dto.discount > 0 ? dto.discount : 0,
          remaining,
        );
        if (manual > 0) {
          discount += manual;
          remaining = Number((remaining - manual).toFixed(2));
        }

        if (dto.promoCode && remaining > 0) {
          const promo = await this.consumePromoTx(
            tx,
            dto.companyId,
            dto.promoCode,
            remaining,
          );
          discount += promo;
          remaining = Number((remaining - promo).toFixed(2));
        }

        if (
          dto.useBonus &&
          dto.useBonus > 0 &&
          order.clientId &&
          remaining > 0
        ) {
          const client = await tx.client.findFirst({
            where: {
              id: order.clientId,
              companyId: dto.companyId,
              deletedAt: null,
            },
            select: { bonusPoints: true },
          });
          const maxByPercent = Number((remaining * 0.3).toFixed(2));
          const bonusUsed = Number(
            Math.min(
              dto.useBonus,
              Number(client?.bonusPoints ?? 0),
              maxByPercent,
              remaining,
            ).toFixed(2),
          );
          if (bonusUsed > 0) {
            const dec = await tx.client.updateMany({
              where: {
                id: order.clientId,
                companyId: dto.companyId,
                deletedAt: null,
                bonusPoints: { gte: bonusUsed },
              },
              data: { bonusPoints: { decrement: bonusUsed } },
            });
            if (dec.count === 0) {
              throw new BadRequestException('Not enough client bonus points');
            }
            discount += bonusUsed;
            remaining = Number((remaining - bonusUsed).toFixed(2));
          }
        }

        if (discount > 0) {
          // remaining уже равен grossTotal − суммарные скидки (каждая ограничена
          // остатком, поэтому remaining ∈ [0, grossTotal]).
          total = remaining;
          await tx.order.update({
            where: { id: order.id },
            data: { total, balanceDue: total },
          });
        }

        if (dto.payments && dto.payments.length > 0) {
          const paySum = Number(
            dto.payments
              .reduce((s, p) => s + (Number(p.amount) || 0), 0)
              .toFixed(2),
          );
          if (Math.abs(paySum - total) > 0.01) {
            throw new BadRequestException(
              'Payment parts must match sale total',
            );
          }
        }

        if (total > 0 && !isDebtSale) {
          const parts =
            dto.payments && dto.payments.length > 0
              ? dto.payments
              : [{ method: dto.method ?? PaymentMethod.CASH, amount: total }];
          for (const part of parts) {
            if (part.amount > 0) {
              await this.addPaymentTx(
                tx,
                order.id,
                { amount: part.amount, method: part.method },
                userId,
                dto.companyId,
              );
            }
          }
        } else if (isDebtSale && total > 0) {
          const debtShiftId = await this.openShiftId(tx, dto.companyId, userId);
          await tx.order.update({
            where: { id: order.id },
            data: { paymentStatus: PaymentStatus.DEBT },
          });
          await tx.payment.create({
            data: {
              companyId: dto.companyId,
              orderId: order.id,
              amount: total,
              method: PaymentMethod.DEBT,
              userId,
              shiftId: debtShiftId,
            },
          });
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: { paid: 0, balanceDue: 0, paymentStatus: PaymentStatus.PAID },
          });
        }

        const posSeq = await nextSeq(tx, dto.companyId, 'POS');
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.DELIVERED,
            receiptNumber: docNumber('POS', posSeq, 5),
          },
        });
        await this.recordStatusChange(
          tx,
          order.id,
          OrderStatus.DELIVERED,
          userId,
          'quick sale delivered',
        );

        // Сводный аудит быстрой продажи (P1-9d). Оплаченный путь дополнительно
        // логируется по-платёжно через addPaymentTx (money:payment).
        await this.audit.recordTx(tx, {
          companyId: dto.companyId,
          userId,
          action: 'money:quick-sale',
          entity: 'order',
          entityId: order.id,
          after: {
            total,
            debtSale: isDebtSale,
            status: OrderStatus.DELIVERED,
          },
        });

        return this.loadFull(tx, order.id);
      });
    } catch (e: any) {
      if (e?.code === 'P2002' && dto.idempotencyKey) {
        const existing = await this.prisma.order.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing && existing.status !== OrderStatus.CANCELLED) {
          return this.findOne(existing.id);
        }
      }
      throw e;
    }
  }

  // ---------- Отложенные чеки (POS) ----------
  holdSale(dto: HoldSaleDto, userId?: string) {
    return this.prisma.heldSale.create({
      data: {
        companyId: dto.companyId,
        branchId: dto.branchId,
        userId,
        label: dto.label,
        note: dto.note,
        total: dto.total ?? 0,
        items: dto.items ?? [],
      },
    });
  }

  listHeld(companyId: string) {
    return this.prisma.heldSale.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  // companyId (из токена) — удаляем только свой отложенный чек.
  async deleteHeld(id: string, companyId?: string) {
    if (companyId) {
      const res = await this.prisma.heldSale.deleteMany({
        where: { id, companyId },
      });
      if (res.count === 0) throw new NotFoundException('Чек не найден');
      return { ok: true };
    }
    return this.prisma.heldSale.delete({ where: { id } });
  }

  // ---------- Возврат заказа ----------
  // Отменяет заказ, возвращает деньги из кассы и возвращает товар на склад.
  // companyId (из токена) — нельзя вернуть чужой заказ.
  async refund(orderId: string, userId?: string, companyId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (companyId && order.companyId !== companyId) {
        throw new NotFoundException('Заказ не найден');
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Заказ уже отменён');
      }

      const paid = Number(order.paid);

      // Доля фактически уплаченного к валовой стоимости строк: скидка/промо/бонус
      // уменьшили order.total, но unitPrice строк остались валовыми. Возврат
      // считаем от НЕТТО-цен, иначе вернём больше, чем клиент заплатил (P0-1).
      const grossSubtotal = order.items.reduce(
        (s, it) => s + Number(it.quantity) * Number(it.unitPrice),
        0,
      );
      const ratio = OrderMath.netRatio(Number(order.total), grossSubtotal);

      // Уже выданные по этому заказу наличные возвраты — чтобы серия
      // «частичный + отмена» не выдала кэшем больше, чем получено (P0-2).
      const priorCash = await tx.return.aggregate({
        where: { orderId, deletedAt: null },
        _sum: { cashRefunded: true },
      });
      const alreadyCashRefunded = Number(priorCash._sum.cashRefunded ?? 0);

      // 1. Возврат денег. Из НАЛИЧНОЙ кассы выдаём только наличную часть — и не
      // больше остатка полученной наличности (за вычетом уже возвращённой);
      // безналичное (карта/перевод/QR) возвращается на карту, ящик не трогает.
      const cashPaid = order.payments
        .filter((p) => p.method === PaymentMethod.CASH)
        .reduce((s, p) => s + Number(p.amount), 0);
      const cashRefund = OrderMath.cashRefundCap(
        paid,
        cashPaid,
        alreadyCashRefunded,
      );
      if (cashRefund > 0) {
        const shiftId = await this.openShiftId(tx, order.companyId, userId);
        await tx.cashMovement.create({
          data: {
            companyId: order.companyId,
            shiftId,
            type: 'OUT',
            amount: cashRefund,
            category: 'Возвраты',
            reason: `Возврат по заказу №${order.orderNumber}`,
          },
        });
      }

      // Сколько уже возвращено по каждой позиции из прошлых документов возврата.
      // Одна выборка на весь refund — используется и для склада, и для сумм/бонусов
      // (раньше тот же запрос выполнялся дважды).
      const priorReturns = await tx.return.findMany({
        where: { orderId, deletedAt: null },
        select: { items: true },
      });
      const returnedByItem = new Map<string, number>();
      for (const r of priorReturns) {
        const items = (Array.isArray(r.items) ? r.items : []) as Array<{
          orderItemId?: string;
          quantity?: number;
        }>;
        for (const li of items) {
          if (li?.orderItemId) {
            returnedByItem.set(
              li.orderItemId,
              (returnedByItem.get(li.orderItemId) ?? 0) +
                Number(li.quantity || 0),
            );
          }
        }
      }

      // 2. Возврат товаров на склад — только то, что ещё не вернули частичными
      // возвратами, иначе товар оприходуется дважды (продано 5, вернули 2, отмена → +3, не +5).
      if (order.branchId) {
        for (const it of order.items) {
          if (it.itemType === ItemType.PRODUCT && it.productId) {
            const alreadyReturned = returnedByItem.get(it.id) ?? 0;
            const restock = Number(
              (Number(it.quantity) - alreadyReturned).toFixed(3),
            );
            if (restock <= 0) continue; // всё уже возвращено ранее
            const cur = await tx.stock.findUnique({
              where: {
                productId_branchId: {
                  productId: it.productId,
                  branchId: order.branchId,
                },
              },
            });
            const before = cur ? Number(cur.quantity) : 0;
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
                quantity: restock,
              },
              update: { quantity: { increment: restock } },
            });
            await tx.stockMovement.create({
              data: {
                companyId: order.companyId,
                productId: it.productId,
                branchId: order.branchId,
                type: StockMovementType.IN,
                quantity: restock,
                beforeQty: before,
                afterQty: Number((before + restock).toFixed(3)),
                reason: `Возврат по заказу №${order.orderNumber}`,
                orderId: order.id,
              },
            });
          }
        }
      }

      // 3. Итоговые позиции и суммы полного возврата — только то, что ещё не вернули
      //    прошлыми частичными возвратами (returnedByItem посчитан выше). Ниже по этим
      //    суммам создаётся документ возврата и сторнируются начисленные бонусы.
      const fullReturnItems: any[] = [];
      let fullReturnAmount = 0;
      let fullReturnCost = 0;
      for (const it of order.items) {
        const alreadyReturned = returnedByItem.get(it.id) ?? 0;
        const quantity = Number(
          (Number(it.quantity) - alreadyReturned).toFixed(3),
        );
        if (quantity <= 0) continue;
        // Нетто-сумма строки (с учётом скидки заказа) — P0-1. Себестоимость
        // не пропорционируем: возвращается реальная стоимость товара.
        const lineAmount = OrderMath.lineReturnAmount(
          quantity,
          Number(it.unitPrice),
          ratio,
        );
        fullReturnAmount += lineAmount;
        fullReturnCost += Number((quantity * Number(it.unitCost)).toFixed(2));
        fullReturnItems.push({
          orderItemId: it.id,
          description: it.description,
          productId: it.productId,
          serviceId: it.serviceId,
          quantity,
          unitPrice: Number(it.unitPrice),
          lineAmount,
        });
      }
      fullReturnAmount = Number(fullReturnAmount.toFixed(2));
      fullReturnCost = Number(fullReturnCost.toFixed(2));
      if (fullReturnAmount > 0) {
        const vozSeq = await nextSeq(tx, order.companyId, 'VOZ');
        const method =
          cashRefund > 0
            ? PaymentMethod.CASH
            : order.payments.find((p) => p.method !== PaymentMethod.DEBT)
                ?.method;
        await tx.return.create({
          data: {
            companyId: order.companyId,
            orderId,
            branchId: order.branchId,
            clientId: order.clientId,
            number: docNumber('VOZ', vozSeq),
            reason: 'full refund',
            amount: fullReturnAmount,
            cashRefunded: cashRefund, // сколько выдано наличными (P0-2)
            method,
            items: fullReturnItems,
            userId,
          },
        });
      }

      if (order.clientId) {
        // Сторнируем бонусы (1% с реально полученных денег) только за ОСТАВШУЮСЯ
        // оплату: частичные возвраты уже сторнировали свою долю (1% с moneyBack) и
        // уменьшили order.paid на возвращённое. Считать 1% со ВСЕХ исходных платежей
        // нельзя — тогда полный возврат после частичного сторнировал бы уже
        // сторнированную долю повторно (finding 919/920). `paid` здесь — остаток
        // фактически полученных денег (order.paid, уже за вычетом прошлых возвратов).
        const earned = Number((paid * 0.01).toFixed(2));
        if (earned > 0) {
          const client = await tx.client.findUnique({
            where: { id: order.clientId },
            select: { bonusPoints: true },
          });
          const newBonus = Math.max(
            0,
            Number((Number(client?.bonusPoints ?? 0) - earned).toFixed(2)),
          );
          await tx.client.update({
            where: { id: order.clientId },
            data: { bonusPoints: newBonus },
          });
        }
      }

      // 4. Помечаем заказ отменённым и обнуляем долг (деньги возвращены,
      //    отменённый заказ не должен висеть в долгах клиента).
      const cancelled = await tx.order.updateMany({
        where: {
          id: orderId,
          status: order.status,
          paid: order.paid,
          returnedTotal: order.returnedTotal,
          returnedCost: order.returnedCost,
        },
        data: {
          status: OrderStatus.CANCELLED,
          paid: 0,
          balanceDue: 0,
          returnedTotal: Number(
            (Number(order.returnedTotal) + fullReturnAmount).toFixed(2),
          ),
          returnedCost: Number(
            (Number(order.returnedCost) + fullReturnCost).toFixed(2),
          ),
          paymentStatus: PaymentStatus.UNPAID,
        },
      });
      if (cancelled.count === 0) {
        throw new BadRequestException('Order changed during refund');
      }
      await this.recordStatusChange(
        tx,
        orderId,
        OrderStatus.CANCELLED,
        userId,
        'refund',
      );

      // Аудит полного возврата: сколько вернули всего и сколько наличными (P1-9d)
      await this.audit.recordTx(tx, {
        companyId: order.companyId,
        userId,
        action: 'money:refund',
        entity: 'order',
        entityId: orderId,
        before: { paid, status: order.status },
        after: {
          status: OrderStatus.CANCELLED,
          refundedTotal: fullReturnAmount,
          cashRefunded: cashRefund,
        },
      });

      return this.loadFull(tx, orderId);
    });
  }

  // ---------- Частичный возврат по чеку ----------
  // Возвращает выбранные позиции (товары — обратно на склад), деньги — из кассы,
  // фиксирует документ возврата и корректирует оплату заказа.
  async createReturn(
    orderId: string,
    dto: CreateReturnDto,
    userId?: string,
    companyId?: string,
  ) {
    if (!dto.items?.length) {
      throw new BadRequestException('Выберите позиции для возврата');
    }
    // Идемпотентность (P0-7): повтор с тем же ключом (двойной клик/ретрай POS)
    // возвращает уже созданный документ возврата, а не проводит второй возврат.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.return.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return existing;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (companyId && order.companyId !== companyId) {
        throw new NotFoundException('Заказ не найден');
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Заказ отменён — возврат невозможен');
      }

      // Сколько уже возвращено по каждой позиции (из прошлых документов возврата),
      // чтобы нельзя было вернуть больше, чем реально продано (двойной возврат).
      const priorReturns = await tx.return.findMany({
        where: { orderId, deletedAt: null },
        select: { items: true },
      });
      const returnedByItem = new Map<string, number>();
      for (const r of priorReturns) {
        const items = (Array.isArray(r.items) ? r.items : []) as Array<{
          orderItemId?: string;
          quantity?: number;
        }>;
        for (const li of items) {
          if (li?.orderItemId) {
            returnedByItem.set(
              li.orderItemId,
              (returnedByItem.get(li.orderItemId) ?? 0) +
                Number(li.quantity || 0),
            );
          }
        }
      }

      // Доля фактически уплаченного к валовой стоимости строк (скидка/промо/бонус
      // уменьшили order.total) — возврат считаем от НЕТТО-цен (P0-1).
      const grossSubtotal = order.items.reduce(
        (s, it) => s + Number(it.quantity) * Number(it.unitPrice),
        0,
      );
      const ratio = OrderMath.netRatio(Number(order.total), grossSubtotal);

      let amount = 0;
      let returnedCost = 0;
      const returned: any[] = [];

      for (const ri of dto.items) {
        const oi = order.items.find((x) => x.id === ri.orderItemId);
        if (!oi) continue;
        // Остаток к возврату по позиции = продано − уже возвращено.
        const alreadyReturned = returnedByItem.get(oi.id) ?? 0;
        const remaining = Number(oi.quantity) - alreadyReturned;
        const qty = Math.min(Number(ri.quantity), remaining);
        if (qty <= 0) continue;
        const lineAmount = OrderMath.lineReturnAmount(
          qty,
          Number(oi.unitPrice),
          ratio,
        );
        amount += lineAmount;
        returnedCost += Number((qty * Number(oi.unitCost)).toFixed(2));
        returned.push({
          orderItemId: oi.id,
          description: oi.description,
          productId: oi.productId,
          serviceId: oi.serviceId,
          quantity: qty,
          unitPrice: Number(oi.unitPrice),
          lineAmount,
        });

        // Товар — возвращаем на склад (приход RETURN с аудитом до/после)
        if (
          oi.itemType === ItemType.PRODUCT &&
          oi.productId &&
          order.branchId
        ) {
          const cur = await tx.stock.findUnique({
            where: {
              productId_branchId: {
                productId: oi.productId,
                branchId: order.branchId,
              },
            },
          });
          const before = cur ? Number(cur.quantity) : 0;
          await tx.stock.upsert({
            where: {
              productId_branchId: {
                productId: oi.productId,
                branchId: order.branchId,
              },
            },
            create: {
              productId: oi.productId,
              branchId: order.branchId,
              quantity: qty,
            },
            update: { quantity: { increment: qty } },
          });
          await tx.stockMovement.create({
            data: {
              companyId: order.companyId,
              productId: oi.productId,
              branchId: order.branchId,
              type: StockMovementType.RETURN,
              quantity: qty,
              beforeQty: before,
              afterQty: Number((before + qty).toFixed(3)),
              reason: `Возврат по заказу №${order.orderNumber}`,
              orderId: order.id,
            },
          });
        }
      }

      amount = Number(amount.toFixed(2));
      returnedCost = Number(returnedCost.toFixed(2));
      if (amount <= 0) {
        throw new BadRequestException('Нечего возвращать');
      }

      // Всего денег к возврату — не больше, чем по заказу оплачено. Для продажи
      // «в долг» деньги не вносились — уменьшаем только долг на стоимость товара.
      const moneyBack = Number(Math.min(amount, Number(order.paid)).toFixed(2));

      // Из НАЛИЧНОЙ кассы выдаём только наличную часть оплаты и не больше остатка
      // полученной наличности за вычетом уже возвращённой кэшем (P0-2); безналичное
      // (карта/перевод/QR) возвращается на карту и ящик не трогает.
      const cashPaid = order.payments
        .filter((p) => p.method === PaymentMethod.CASH)
        .reduce((s, p) => s + Number(p.amount), 0);
      const priorCash = await tx.return.aggregate({
        where: { orderId, deletedAt: null },
        _sum: { cashRefunded: true },
      });
      const cashBack = OrderMath.cashRefundCap(
        moneyBack,
        cashPaid,
        Number(priorCash._sum.cashRefunded ?? 0),
      );

      // Наличный расход — привязан к открытой смене кассира (иначе не попадёт в Z-отчёт).
      if (cashBack > 0) {
        const shiftId = await this.openShiftId(tx, order.companyId, userId);
        await tx.cashMovement.create({
          data: {
            companyId: order.companyId,
            shiftId,
            type: 'OUT',
            amount: cashBack,
            category: 'Возвраты',
            reason: `Возврат по заказу №${order.orderNumber}`,
          },
        });
      }

      // Документ возврата
      const vozSeq = await nextSeq(tx, order.companyId, 'VOZ');
      const ret = await tx.return.create({
        data: {
          companyId: order.companyId,
          orderId,
          branchId: order.branchId,
          clientId: order.clientId,
          number: docNumber('VOZ', vozSeq),
          reason: dto.reason,
          amount,
          cashRefunded: cashBack, // сколько выдано наличными (P0-2)
          method: dto.method,
          items: returned,
          userId,
          idempotencyKey: dto.idempotencyKey, // P0-7
        },
      });

      // Возвраты — отдельной строкой: сам заказ (сумма и позиции) остаётся
      // «валовым», а возвращённое копится в returnedTotal/returnedCost
      // (контр-выручка). Оплата уменьшается на реально возвращённые деньги.
      // Долг = итог − возвраты − оплата (не меньше нуля) — корректно и для «в долг».
      const newReturnedTotal = Number(
        (Number(order.returnedTotal) + amount).toFixed(2),
      );
      const newReturnedCost = Number(
        (Number(order.returnedCost) + returnedCost).toFixed(2),
      );
      // Оплата уменьшается на все реально возвращённые деньги (наличные + безнал).
      const newPaid = Number(
        Math.max(0, Number(order.paid) - moneyBack).toFixed(2),
      );
      const newBalanceDue = Number(
        Math.max(0, Number(order.total) - newReturnedTotal - newPaid).toFixed(
          2,
        ),
      );
      const newPaymentStatus =
        newBalanceDue <= 0
          ? PaymentStatus.PAID
          : order.paymentStatus === PaymentStatus.DEBT
            ? PaymentStatus.DEBT
            : newPaid > 0
              ? PaymentStatus.PARTIAL
              : PaymentStatus.UNPAID;
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: order.status,
          paid: order.paid,
          returnedTotal: order.returnedTotal,
          returnedCost: order.returnedCost,
        },
        data: {
          returnedTotal: newReturnedTotal,
          returnedCost: newReturnedCost,
          paid: newPaid,
          balanceDue: newBalanceDue,
          paymentStatus: newPaymentStatus,
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException('Order changed during return');
      }

      // Сторнируем начисленные бонусы пропорционально реально возвращённым деньгам
      // (1% — как при начислении в addPayment), чтобы возврат не оставлял «лишних» баллов.
      if (order.clientId && moneyBack > 0) {
        const earned = Number((moneyBack * 0.01).toFixed(2));
        if (earned > 0) {
          const client = await tx.client.findUnique({
            where: { id: order.clientId },
            select: { bonusPoints: true },
          });
          const newBonus = Math.max(
            0,
            Number((Number(client?.bonusPoints ?? 0) - earned).toFixed(2)),
          );
          await tx.client.update({
            where: { id: order.clientId },
            data: { bonusPoints: newBonus },
          });
        }
      }

      // Аудит частичного возврата со снимком оплаты/возвращённого (P1-9d)
      await this.audit.recordTx(tx, {
        companyId: order.companyId,
        userId,
        action: 'money:return',
        entity: 'order',
        entityId: orderId,
        before: {
          paid: Number(order.paid),
          returnedTotal: Number(order.returnedTotal),
          paymentStatus: order.paymentStatus,
        },
        after: {
          returnId: ret.id,
          paid: newPaid,
          returnedTotal: newReturnedTotal,
          paymentStatus: newPaymentStatus,
          refundedTotal: moneyBack,
          cashRefunded: cashBack,
        },
      });

      return ret;
    });
    } catch (e: any) {
      // Гонка: параллельный запрос с тем же ключом успел создать возврат первым —
      // отдаём уже созданный документ вместо ошибки уникальности (P0-7).
      if (e?.code === 'P2002' && dto.idempotencyKey) {
        const existing = await this.prisma.return.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  listReturns(companyId: string) {
    return this.prisma.return.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---------- Повторить заказ ----------
  // Создаёт новый заказ-копию по позициям и характеристикам существующего.
  async reorder(orderId: string, companyId?: string) {
    const src = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!src) throw new NotFoundException('Заказ не найден');
    if (companyId && src.companyId !== companyId) {
      throw new NotFoundException('Заказ не найден');
    }

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
  async updateStatus(
    orderId: string,
    status: OrderStatus,
    userId?: string,
    reason?: string,
    companyId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (companyId && order.companyId !== companyId) {
      throw new NotFoundException('Заказ не найден');
    }
    // Отмену нельзя проводить простой сменой статуса: иначе долг/оплата/склад
    // останутся неоткаченными (долг «исчезнет», товар не вернётся, деньги не выданы).
    // Отмена — только через refund(), который корректно всё сторнирует.
    if (status === OrderStatus.CANCELLED) {
      throw new BadRequestException(
        'Отмена заказа — через «Возврат» (кнопка refund): он вернёт деньги, товар и спишет бонусы',
      );
    }
    if (order.status === status) return this.findOne(orderId);

    await this.prisma.$transaction((tx) =>
      this.transitionOrderStatus(tx, orderId, status, userId, reason),
    );

    // Уведомление о готовности заказа: Telegram + email клиенту
    if (status === OrderStatus.READY) {
      void this.telegram.send(
        order.companyId,
        `✅ Заказ №${order.orderNumber} готов к выдаче`,
      );
      if (order.clientId) {
        void this.prisma.client
          .findUnique({
            where: { id: order.clientId },
            select: { email: true, fullName: true },
          })
          .then((client) => {
            if (client?.email) {
              void this.email.send(
                order.companyId,
                client.email,
                `Заказ №${order.orderNumber} готов`,
                `Здравствуйте${client.fullName ? ', ' + client.fullName : ''}!\n\nВаш заказ №${order.orderNumber} готов к выдаче.\n\nСпасибо, что выбрали нас!`,
              );
            }
          });
      }
    }

    return this.findOne(orderId);
  }

  // ---------- Списки и чтение ----------
  // Общий конструктор условий выборки заказов из фильтров.
  private buildWhere(
    companyId: string,
    f: OrderFilters,
  ): Prisma.OrderWhereInput {
    return {
      companyId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.orderType ? { orderType: f.orderType } : {}),
      ...(f.managerId ? { assignedUserId: f.managerId } : {}),
      ...(f.dateFrom || f.dateTo
        ? {
            createdAt: {
              ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}),
              ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}),
            },
          }
        : {}),
      ...(f.search
        ? {
            OR: [
              { orderNumber: { contains: f.search, mode: 'insensitive' } },
              {
                client: {
                  fullName: { contains: f.search, mode: 'insensitive' },
                },
              },
              { client: { phone: { contains: f.search } } },
            ],
          }
        : {}),
    };
  }

  async findAll(companyId: string, f: OrderFilters = {}) {
    const where = this.buildWhere(companyId, f);
    const take = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
    const page = Math.max(f.page ?? 1, 1);
    const skip = (page - 1) * take;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          client: true,
          items: true,
          assignedUser: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page, pageSize: take };
  }

  // Сводка по статусам и суммам для карточек на странице «Заказы».
  // Учитывает все фильтры, КРОМЕ статуса — чтобы карточки показывали разбивку.
  async stats(companyId: string, f: OrderFilters = {}) {
    const where = this.buildWhere(companyId, { ...f, status: undefined });
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });
    const agg = await this.prisma.order.aggregate({
      where,
      _sum: { total: true },
      _count: true,
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;
    return {
      total: agg._count,
      totalSum: Number(agg._sum.total ?? 0),
      byStatus,
    };
  }

  // companyId (из токена) — проверка владельца: заказ чужой компании не отдаём.
  async findOne(id: string, companyId?: string) {
    const order = await this.loadFull(this.prisma, id);
    if (!order) throw new NotFoundException('Заказ не найден');
    if (companyId && order.companyId !== companyId) {
      throw new NotFoundException('Заказ не найден');
    }

    // Резолвим имена пользователей в истории статусов
    const hist = order.statusHistory ?? [];
    const userIds = [
      ...new Set(hist.map((h: any) => h.userId).filter(Boolean)),
    ] as string[];
    if (userIds.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      });
      const nameById = new Map(users.map((u) => [u.id, u.fullName]));
      order.statusHistory = hist.map((h: any) => ({
        ...h,
        userName: h.userId ? (nameById.get(h.userId) ?? '—') : 'система',
      }));
    } else {
      order.statusHistory = hist.map((h: any) => ({
        ...h,
        userName: 'система',
      }));
    }
    return order;
  }

  // Долги: заказы с непогашенным остатком
  async debts(companyId: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        companyId,
        status: { not: OrderStatus.CANCELLED },
        balanceDue: { gt: new Prisma.Decimal(0) },
      },
      include: { client: true },
      orderBy: { createdAt: 'asc' },
    });
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      client: o.client?.fullName ?? o.client?.phone ?? 'без клиента',
      phone: o.client?.phone ?? '',
      total: Number(o.total),
      paid: Number(o.paid),
      debt: Number(o.balanceDue),
      dueDate: o.debtDueDate,
      overdue: o.debtDueDate ? new Date(o.debtDueDate) < startOfToday : false,
    }));
  }

  // Установить/изменить срок погашения долга по заказу
  async setDebtDue(
    orderId: string,
    dueDate: string | null,
    companyId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (companyId && order.companyId !== companyId) {
      throw new NotFoundException('Заказ не найден');
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: { debtDueDate: dueDate ? new Date(dueDate) : null },
    });
  }

  // Открытая смена кассира (для привязки движений кассы к Z-отчёту).
  // Без неё расход/возврат не попадёт в отчёт кассы и исказит остаток наличных.
  private async openShiftId(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId?: string,
  ): Promise<string> {
    if (!userId) throw new BadRequestException('Open cash shift not found');
    const shift = await tx.cashShift.findFirst({
      where: { companyId, userId, closedAt: null, deletedAt: null },
    });
    if (!shift) throw new BadRequestException('Open cash shift not found');
    return shift.id;
  }

  // Запись перехода статуса заказа в историю (OrderStatusHistory).
  // Через неё проходит КАЖДАЯ смена Order.status — иначе этап пропадёт из карточки
  // заказа (напр. быстрая продажа → DELIVERED, возврат → CANCELLED, п. P1-10 аудита).
  private recordStatusChange(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: OrderStatus,
    userId?: string,
    reason?: string,
  ) {
    return tx.orderStatusHistory.create({
      data: { orderId, status, userId, reason },
    });
  }

  // Простой переход статуса заказа: меняет Order.status и пишет историю в одной
  // транзакции. Переходы, совмещённые с денежными полями и optimistic-guard
  // (быстрая продажа, возврат), меняют статус вместе с ними, но историю пишут
  // через тот же recordStatusChange() — так инвариант «смена статуса → история»
  // соблюдается централизованно.
  private async transitionOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: OrderStatus,
    userId?: string,
    reason?: string,
  ) {
    await tx.order.update({ where: { id: orderId }, data: { status } });
    await this.recordStatusChange(tx, orderId, status, userId, reason);
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
              include: {
                materials: {
                  include: { product: { include: { unit: true } } },
                },
              },
            },
            product: { include: { unit: true } },
          },
        },
        payments: true,
        repairDetail: true,
        recoveryDetail: true,
        files: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
        assignedUser: { select: { id: true, fullName: true } },
        designer: { select: { id: true, fullName: true } },
        operator: { select: { id: true, fullName: true } },
      },
    });
  }
}
