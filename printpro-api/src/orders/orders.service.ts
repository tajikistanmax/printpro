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
import {
  AddPaymentDto,
  QuickSaleDto,
  HoldSaleDto,
  CreateReturnDto,
} from './dto/order-actions.dto';
import { PromocodesService } from '../promocodes/promocodes.service';
import { EmailService } from '../email/email.service';

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
    private readonly clients: ClientsService,
    private readonly telegram: TelegramService,
    private readonly promocodes: PromocodesService,
    private readonly email: EmailService,
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

    // Себестоимость товаров — из закупочной цены, если не передана
    const productIds = dto.items
      .filter((it) => it.productId)
      .map((it) => it.productId!);
    const productCosts = productIds.length
      ? new Map(
          (
            await this.prisma.product.findMany({
              where: { id: { in: productIds } },
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
          ? serviceCosts.get(it.serviceId) ?? 0
          : it.productId
            ? productCosts.get(it.productId) ?? 0
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
      const count = await tx.order.count({ where: { companyId: dto.companyId } });
      const year = new Date().getFullYear();
      const seq = String(count + 1).padStart(6, '0');
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
    });
  }

  // ---------- Добавить оплату (касса) ----------
  // userId — кассир из токена; если смена не указана явно, привязываем
  // оплату к его текущей открытой смене, чтобы она попала в отчёт кассы.
  async addPayment(orderId: string, dto: AddPaymentDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Заказ не найден');

      // Защита от переплаты: нельзя внести больше, чем осталось к оплате.
      // Долговая оплата (method DEBT) здесь не проводится — это отдельный сценарий POS.
      const balanceBefore = Number(
        (Number(order.total) - Number(order.paid)).toFixed(2),
      );
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
    // Продажа товара без склада не спишет остаток — не допускаем «фантомную» продажу.
    const hasProducts = (dto.items ?? []).some(
      (i) => i.itemType === ItemType.PRODUCT || !!i.productId,
    );
    if (hasProducts && !dto.branchId) {
      throw new BadRequestException(
        'Для продажи товара укажите склад (филиал) — иначе остаток не спишется',
      );
    }

    // Идемпотентность: повтор той же продажи (двойной клик / обрыв сети) не создаёт дубль.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return this.findOne(existing.id);
    }

    let order: Awaited<ReturnType<typeof this.create>>;
    try {
      order = await this.create({
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
    } catch (e: any) {
      // Гонка: параллельный запрос с тем же ключом уже создал заказ
      if (e?.code === 'P2002' && dto.idempotencyKey) {
        const ex = await this.prisma.order.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (ex) return this.findOne(ex.id);
      }
      throw e;
    }

    // Всё после создания заказа оборачиваем в откат: при любой ошибке
    // (неверная скидка/промокод, недоплата, сбой) возвращаем товар на склад и
    // отменяем заказ, чтобы не осталось «недооформленной» продажи.
    try {
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

      // Списание бонусов (п. 8.6) — не более 30% от суммы и не больше остатка
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

      // Смешанная оплата: части должны в сумме давать итог, иначе чек
      // окажется недоплаченным (и всё равно был бы помечен выданным).
      if (dto.payments && dto.payments.length > 0) {
        const paySum = Number(
          dto.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0).toFixed(2),
        );
        if (Math.abs(paySum - total) > 0.01) {
          throw new BadRequestException(
            `Сумма частей оплаты (${paySum} c.) должна равняться итогу (${total} c.)`,
          );
        }
      }

      // «В долг»: оплату НЕ проводим — заказ остаётся неоплаченным (balanceDue = итог),
      // это и есть задолженность клиента (видно в списке заказов и долгах).
      const isDebt =
        dto.method === PaymentMethod.DEBT &&
        (!dto.payments || dto.payments.length === 0);

      // Оплата: смешанная (несколько способов) или одним способом
      if (total > 0 && !isDebt) {
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
      } else if (isDebt && total > 0) {
        // Продажа «в долг»: деньги не внесены, весь итог — задолженность клиента.
        // Помечаем статусом DEBT, чтобы отличать от забытой неоплаты (UNPAID).
        await this.prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.DEBT },
        });
        // Запись оплаты со способом DEBT (сумма = итог), привязанная к смене кассира.
        // Она НЕ меняет paid/balanceDue (долг остаётся), но отражает продажу «в долг»
        // в строке «в долг» Z-отчёта и отчёта выручки (реальные деньги её исключают).
        const debtShiftId = userId
          ? (
              await this.prisma.cashShift.findFirst({
                where: { companyId: dto.companyId, userId, closedAt: null },
              })
            )?.id
          : undefined;
        await this.prisma.payment.create({
          data: {
            companyId: dto.companyId,
            orderId: order.id,
            amount: total,
            method: PaymentMethod.DEBT,
            userId,
            shiftId: debtShiftId,
          },
        });
      } else if (total <= 0) {
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
    } catch (e) {
      // Откат частичной продажи: вернуть товар на склад и отменить заказ.
      await this.refund(order.id, userId).catch(() => {});
      throw e;
    }

    return this.findOne(order.id);
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

  deleteHeld(id: string) {
    return this.prisma.heldSale.delete({ where: { id } });
  }

  // ---------- Возврат заказа ----------
  // Отменяет заказ, возвращает деньги из кассы и возвращает товар на склад.
  async refund(orderId: string, userId?: string) {
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

      // 1. Возврат денег из кассы (расход) — привязываем к открытой смене кассира,
      // иначе расход не попадёт в Z-отчёт и завысит остаток наличных.
      if (paid > 0) {
        const shiftId = await this.openShiftId(tx, order.companyId, userId);
        await tx.cashMovement.create({
          data: {
            companyId: order.companyId,
            shiftId,
            type: 'OUT',
            amount: paid,
            category: 'Возвраты',
            reason: `Возврат по заказу №${order.orderNumber}`,
          },
        });
      }

      // 2. Возврат товаров на склад
      if (order.branchId) {
        for (const it of order.items) {
          if (it.itemType === ItemType.PRODUCT && it.productId) {
            const cur = await tx.stock.findUnique({
              where: {
                productId_branchId: { productId: it.productId, branchId: order.branchId },
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
                beforeQty: before,
                afterQty: Number((before + Number(it.quantity)).toFixed(3)),
                reason: `Возврат по заказу №${order.orderNumber}`,
                orderId: order.id,
              },
            });
          }
        }
      }

      // 3. Помечаем заказ отменённым и обнуляем долг (деньги возвращены,
      //    отменённый заказ не должен висеть в долгах клиента).
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, paid: 0, balanceDue: 0 },
      });

      return this.loadFull(tx, orderId);
    });
  }

  // ---------- Частичный возврат по чеку ----------
  // Возвращает выбранные позиции (товары — обратно на склад), деньги — из кассы,
  // фиксирует документ возврата и корректирует оплату заказа.
  async createReturn(orderId: string, dto: CreateReturnDto, userId?: string) {
    if (!dto.items?.length) {
      throw new BadRequestException('Выберите позиции для возврата');
    }
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');

      let amount = 0;
      const returned: any[] = [];

      for (const ri of dto.items) {
        const oi = order.items.find((x) => x.id === ri.orderItemId);
        if (!oi) continue;
        const qty = Math.min(Number(ri.quantity), Number(oi.quantity));
        if (qty <= 0) continue;
        const lineAmount = Number((qty * Number(oi.unitPrice)).toFixed(2));
        amount += lineAmount;
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
        if (oi.itemType === ItemType.PRODUCT && oi.productId && order.branchId) {
          const cur = await tx.stock.findUnique({
            where: {
              productId_branchId: { productId: oi.productId, branchId: order.branchId },
            },
          });
          const before = cur ? Number(cur.quantity) : 0;
          await tx.stock.upsert({
            where: {
              productId_branchId: { productId: oi.productId, branchId: order.branchId },
            },
            create: { productId: oi.productId, branchId: order.branchId, quantity: qty },
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

        // Уменьшаем позицию заказа на возвращённое количество, чтобы отчёты
        // (прибыль, продажи по позициям) считались от чистых продаж.
        const leftQty = Number((Number(oi.quantity) - qty).toFixed(3));
        await tx.orderItem.update({
          where: { id: oi.id },
          data: {
            quantity: leftQty,
            lineTotal: Number((leftQty * Number(oi.unitPrice)).toFixed(2)),
            lineCost: Number((leftQty * Number(oi.unitCost)).toFixed(2)),
          },
        });
      }

      amount = Number(amount.toFixed(2));
      if (amount <= 0) {
        throw new BadRequestException('Нечего возвращать');
      }

      // Реально из кассы возвращаем не больше, чем по заказу оплачено.
      // Для продажи «в долг» деньги не вносились — наличных не возвращаем,
      // просто уменьшаем долг на стоимость возвращённого товара.
      const cashRefund = Number(Math.min(amount, Number(order.paid)).toFixed(2));

      // Деньги обратно — расход из кассы, привязанный к открытой смене кассира
      // (иначе возврат не отразится в Z-отчёте и завысит наличные).
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

      // Документ возврата
      const count = await tx.return.count({ where: { companyId: order.companyId } });
      const ret = await tx.return.create({
        data: {
          companyId: order.companyId,
          orderId,
          branchId: order.branchId,
          clientId: order.clientId,
          number: docNumber('VOZ', count + 1),
          reason: dto.reason,
          amount,
          method: dto.method,
          items: returned,
          userId,
        },
      });

      // Возврат уменьшает сумму заказа на стоимость возвращённых товаров,
      // а оплату — на реально возвращённые деньги. Долг = итог − оплата (≥0).
      const newTotal = Number(Math.max(0, Number(order.total) - amount).toFixed(2));
      const newPaid = Number(Math.max(0, Number(order.paid) - cashRefund).toFixed(2));
      await tx.order.update({
        where: { id: orderId },
        data: {
          total: newTotal,
          paid: newPaid,
          balanceDue: Number(Math.max(0, newTotal - newPaid).toFixed(2)),
        },
      });

      return ret;
    });
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
  async updateStatus(
    orderId: string,
    status: OrderStatus,
    userId?: string,
    reason?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status === status) return this.findOne(orderId);

    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status } }),
      this.prisma.orderStatusHistory.create({
        data: { orderId, status, userId, reason },
      }),
    ]);

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

  async findOne(id: string) {
    const order = await this.loadFull(this.prisma, id);
    if (!order) throw new NotFoundException('Заказ не найден');

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
        userName: h.userId ? nameById.get(h.userId) ?? '—' : 'система',
      }));
    } else {
      order.statusHistory = hist.map((h: any) => ({ ...h, userName: 'система' }));
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
  async setDebtDue(orderId: string, dueDate: string | null) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
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
  ): Promise<string | undefined> {
    if (!userId) return undefined;
    const shift = await tx.cashShift.findFirst({
      where: { companyId, userId, closedAt: null },
    });
    return shift?.id;
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
        statusHistory: { orderBy: { createdAt: 'desc' } },
        assignedUser: { select: { id: true, fullName: true } },
        designer: { select: { id: true, fullName: true } },
        operator: { select: { id: true, fullName: true } },
      },
    });
  }
}
