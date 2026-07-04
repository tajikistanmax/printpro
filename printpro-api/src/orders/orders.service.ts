import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ItemType,
  OrderStatus,
  OrderType,
  OrderUrgency,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductionStatus,
  ProofStatus,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
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
  // opts.applyClientDiscount — применить персональную скидку клиента (%) к итогу.
  // Включается только для печатных заказов из контроллера: POS (quickSale)
  // применяет скидку сам после создания, повтор заказа копирует старые цены.
  async create(
    dto: CreateOrderDto,
    opts: { applyClientDiscount?: boolean; applyTax?: boolean } = {},
  ) {
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
    let total = Number(
      items.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2),
    );

    // Персональная скидка клиента (%) — как на кассе (К5), автоматически.
    if (opts.applyClientDiscount && clientId && total > 0) {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: { discount: true },
      });
      const pct = Number(client?.discount ?? 0);
      if (pct > 0) {
        const disc = Number(((total * pct) / 100).toFixed(2));
        total = Math.max(0, Number((total - disc).toFixed(2)));
      }
    }

    // Налог (НДС): если задан taxPercent — начисляется сверх суммы после скидок
    // (отдельная строка в чеке/счёте). taxAmount фиксируем снимком на заказе.
    // В POS (quickSale) налог считается ПОСЛЕ его скидок/бонусов — там applyTax=false,
    // а налог начисляется на финальный итог в quickSale (иначе двойной налог).
    let taxPercent = 0;
    let taxAmount = 0;
    if (opts.applyTax !== false) {
      const taxRow = await this.prisma.setting.findFirst({
        where: { companyId: dto.companyId, key: 'taxPercent' },
      });
      const p = taxRow?.value ? Number(taxRow.value) : 0;
      if (Number.isFinite(p) && p > 0) {
        taxPercent = p;
        taxAmount = Number(((total * p) / 100).toFixed(2));
        total = Number((total + taxAmount).toFixed(2));
      }
    }

    // 3. Всё в одной транзакции (либо всё, либо ничего)
    return this.prisma.$transaction(async (tx) => {
      // 2.5. Кредитный лимит клиента (п. 8.4 ТЗ): если долг + новый заказ
      // превышают лимит — блок. Проверяем ВНУТРИ транзакции (не до неё), чтобы
      // два параллельных заказа не проскочили лимит по отдельности.
      if (clientId) {
        // Advisory-lock по клиенту на время транзакции: сериализует ТОЛЬКО
        // одновременные заказы одного клиента, поэтому aggregate долга ниже
        // читается корректно (под READ COMMITTED сам по себе он не блокирует).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
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
          taxPercent,
          taxAmount,
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
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (companyId && order.companyId !== companyId) {
        throw new NotFoundException('Заказ не найден');
      }
      // Нельзя принять оплату по отменённому/возвращённому заказу — иначе на
      // CANCELLED-заказ (после refund) прилетит «фантомная» выручка за уже
      // возвращённый товар. deletedAt тоже отсекаем.
      if (order.status === OrderStatus.CANCELLED || order.deletedAt) {
        throw new BadRequestException(
          'Нельзя принять оплату по отменённому заказу',
        );
      }

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

      // Привязка к открытой смене: явный shiftId или текущая смена кассира.
      // Переданный shiftId проверяем на принадлежность компании/кассиру и что
      // смена открыта — иначе можно было бы дописать деньги в закрытый Z-отчёт
      // или в смену другой компании/кассира. Невалидный — игнорируем.
      let shiftId = dto.shiftId;
      if (shiftId) {
        const sh = await tx.cashShift.findFirst({
          where: {
            id: shiftId,
            companyId: order.companyId,
            closedAt: null,
            ...(cashierId ? { userId: cashierId } : {}),
          },
          select: { id: true },
        });
        if (!sh) shiftId = undefined;
      }
      if (!shiftId && cashierId) {
        const openShift = await tx.cashShift.findFirst({
          where: {
            companyId: order.companyId,
            userId: cashierId,
            closedAt: null,
          },
        });
        shiftId = openShift?.id;
      }
      // Требование открытой смены (настройка requireOpenShift, по умолчанию выкл):
      // без смены наличные выпадают из Z-отчёта и сверки, поэтому оплату не проводим.
      if (!shiftId) {
        const rs = await tx.setting.findFirst({
          where: { companyId: order.companyId, key: 'requireOpenShift' },
        });
        if (rs?.value === '1' || rs?.value === 'true') {
          throw new BadRequestException(
            'Откройте кассовую смену, чтобы принять оплату',
          );
        }
      }

      const newPaid = Number((Number(order.paid) + dto.amount).toFixed(2));
      const balanceDue = Number((Number(order.total) - newPaid).toFixed(2));

      // Статус оплаты
      let paymentStatus: PaymentStatus;
      if (balanceDue <= 0) paymentStatus = PaymentStatus.PAID;
      else if (newPaid > 0) paymentStatus = PaymentStatus.PARTIAL;
      else paymentStatus = PaymentStatus.UNPAID;

      // Оптимистичная блокировка: обновляем заказ только если `paid` не изменился
      // с момента чтения. Иначе два параллельных запроса (двойной клик) прочитали бы
      // один и тот же остаток и создали переплату. Здесь второй запрос получит count=0.
      const upd = await tx.order.updateMany({
        // status guard закрывает гонку с параллельным refund (отмена заказа)
        where: {
          id: orderId,
          paid: order.paid,
          status: { not: OrderStatus.CANCELLED },
          deletedAt: null,
        },
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

      // Бонусы клиенту: % от внесённой суммы (п. 8.6), кроме оплаты «в долг».
      // Ставка начисления берётся из настроек компании (по умолчанию 1%).
      if (order.clientId && dto.method !== PaymentMethod.DEBT) {
        const { accrual } = await this.bonusRates(order.companyId);
        const bonus = Number((dto.amount * accrual).toFixed(2));
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

    // Продажа «в долг» без клиента = непогашаемый долг «без клиента». Требуем клиента.
    const isDebtSale =
      dto.method === PaymentMethod.DEBT &&
      (!dto.payments || dto.payments.length === 0);
    if (isDebtSale && !dto.clientPhone?.trim()) {
      throw new BadRequestException('Для продажи «в долг» укажите клиента');
    }

    // «В долг» нельзя смешивать с обычной оплатой: DEBT-часть не является деньгами,
    // и её проведение как платежа закрыло бы заказ без реальной оплаты.
    if (dto.payments?.some((p) => p.method === PaymentMethod.DEBT)) {
      throw new BadRequestException(
        'Способ «В долг» нельзя использовать в смешанной оплате',
      );
    }

    // Идемпотентность: повтор той же продажи (двойной клик / обрыв сети) не создаёт дубль.
    // Отменённый заказ (откат неудавшейся продажи) НЕ считаем результатом — иначе
    // повтор вернул бы отменённый чек как «успешный». При откате ключ и так очищается,
    // это дополнительная защита на случай гонки.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing && existing.status !== OrderStatus.CANCELLED) {
        return this.findOne(existing.id);
      }
    }

    let order: Awaited<ReturnType<typeof this.create>>;
    try {
      order = await this.create(
        {
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
        },
        // Налог начислим в quickSale после скидок/бонусов (иначе двойной налог)
        { applyTax: false },
      );
    } catch (e: any) {
      // Гонка: параллельный запрос с тем же ключом уже создал заказ
      if (e?.code === 'P2002' && dto.idempotencyKey) {
        const ex = await this.prisma.order.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (ex && ex.status !== OrderStatus.CANCELLED)
          return this.findOne(ex.id);
      }
      throw e;
    }

    // Всё после создания заказа оборачиваем в откат: при любой ошибке
    // (неверная скидка/промокод, недоплата, сбой) возвращаем товар на склад,
    // отменяем заказ И компенсируем побочные эффекты (бонусы, промокод),
    // чтобы клиент не потерял списанные баллы, а промокод — использование.
    // bonusUsed/promoConsumed объявлены вне try — нужны в блоке отката.
    let bonusUsed = 0;
    let promoConsumed = false;
    try {
      // Скидка (абсолютная) — уменьшаем итог. Зажимаем сверху стоимостью
      // товаров: ручная скидка не может превышать сумму заказа (защита от
      // абсурдных/отрицательных значений с фронта). Полноценный лимит по %
      // и права на скидку — отдельная настройка компании.
      let total = Number(order.total);
      const subtotal = Number(order.total); // сумма позиций до скидок
      const rawDiscount = dto.discount && dto.discount > 0 ? dto.discount : 0;
      let discount = Math.min(rawDiscount, total);

      // Лимит ручной скидки: если задан posMaxDiscountPercent и у кассира нет
      // права pos.discountUnlimited — ручная скидка не может превышать этот % от
      // суммы позиций (защита от 100%-скидки кассиром). Без настройки — лимита нет.
      if (rawDiscount > 0) {
        const maxRow = await this.prisma.setting.findFirst({
          where: { companyId: dto.companyId, key: 'posMaxDiscountPercent' },
        });
        const maxPct = maxRow?.value ? Number(maxRow.value) : NaN;
        if (Number.isFinite(maxPct) && maxPct >= 0) {
          const unlimited = await this.userHasPermission(
            userId,
            'pos.discountUnlimited',
          );
          if (!unlimited) {
            const maxDisc = Number(((subtotal * maxPct) / 100).toFixed(2));
            if (rawDiscount > maxDisc + 0.01) {
              throw new BadRequestException(
                `Скидка ${rawDiscount} c. превышает лимит ${maxPct}% (макс ${maxDisc} c.). Требуется право «Скидка сверх лимита».`,
              );
            }
          }
        }
      }

      // Персональная скидка клиента (%) — по ТЗ применяется автоматически при
      // выборе клиента. Считаем от суммы позиций (subtotal), чтобы фронт мог
      // повторить расчёт один-в-один и итог совпал при смешанной оплате.
      if (order.clientId) {
        const c = await this.prisma.client.findUnique({
          where: { id: order.clientId },
          select: { discount: true },
        });
        const pct = Number(c?.discount ?? 0);
        if (pct > 0) {
          discount += Number(((subtotal * pct) / 100).toFixed(2));
        }
      }

      // Промокод (п. 8.7) — добавляем к скидке
      if (dto.promoCode) {
        const promoDisc = await this.promocodes.consume(
          dto.companyId,
          dto.promoCode,
          total,
        );
        promoConsumed = true;
        discount += promoDisc;
      }

      // Списание бонусов (п. 8.6) — не более N% от суммы (из настроек, по
      // умолчанию 30%) и не больше остатка баллов клиента.
      if (dto.useBonus && dto.useBonus > 0 && order.clientId) {
        const client = await this.prisma.client.findUnique({
          where: { id: order.clientId },
          select: { bonusPoints: true },
        });
        const { maxRedeem } = await this.bonusRates(dto.companyId);
        const maxByPercent = Number((total * maxRedeem).toFixed(2));
        bonusUsed = Math.min(
          dto.useBonus,
          Number(client?.bonusPoints ?? 0),
          maxByPercent,
        );
        bonusUsed = Number(bonusUsed.toFixed(2));
        if (bonusUsed > 0) {
          // Атомарное списание: проходит только если баллов реально хватает.
          // Защищает от гонки — два одновременных чека не уведут баланс в минус.
          const dec = await this.prisma.client.updateMany({
            where: { id: order.clientId, bonusPoints: { gte: bonusUsed } },
            data: { bonusPoints: { decrement: bonusUsed } },
          });
          if (dec.count === 0) {
            throw new BadRequestException(
              'Недостаточно бонусов у клиента (возможно, списаны параллельно)',
            );
          }
          discount += bonusUsed;
        }
      }

      total = Math.max(0, Number((total - discount).toFixed(2)));

      // Налог (НДС) сверх итога после всех скидок/бонусов — снимок на заказе.
      let taxPercent = 0;
      let taxAmount = 0;
      const taxRow = await this.prisma.setting.findFirst({
        where: { companyId: dto.companyId, key: 'taxPercent' },
      });
      const tp = taxRow?.value ? Number(taxRow.value) : 0;
      if (Number.isFinite(tp) && tp > 0) {
        taxPercent = tp;
        taxAmount = Number(((total * tp) / 100).toFixed(2));
        total = Number((total + taxAmount).toFixed(2));
      }

      if (discount > 0 || taxAmount > 0) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { total, balanceDue: total, taxPercent, taxAmount },
        });
      }

      // Смешанная оплата: части должны в сумме давать итог, иначе чек
      // окажется недоплаченным (и всё равно был бы помечен выданным).
      if (dto.payments && dto.payments.length > 0) {
        const paySum = Number(
          dto.payments
            .reduce((s, p) => s + (Number(p.amount) || 0), 0)
            .toFixed(2),
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
        // Требование открытой смены распространяем и на продажу «в долг» —
        // иначе она не попадёт в строку «в долг» Z-отчёта смены.
        if (!debtShiftId) {
          const rs = await this.prisma.setting.findFirst({
            where: { companyId: dto.companyId, key: 'requireOpenShift' },
          });
          if (rs?.value === '1' || rs?.value === 'true') {
            throw new BadRequestException(
              'Откройте кассовую смену, чтобы оформить продажу в долг',
            );
          }
        }
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
      const posSeq = await nextSeq(this.prisma, dto.companyId, 'POS');
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.DELIVERED,
          receiptNumber: docNumber('POS', posSeq, 5),
        },
      });
    } catch (e) {
      // Откат частичной продажи: вернуть товар на склад, отменить заказ и
      // компенсировать побочные эффекты, чтобы ничего не «сгорело» безвозвратно.
      // 1) Вернуть списанные бонусы клиенту.
      if (bonusUsed > 0 && order.clientId) {
        await this.prisma.client
          .update({
            where: { id: order.clientId },
            data: { bonusPoints: { increment: bonusUsed } },
          })
          .catch((err) =>
            console.error('quickSale rollback: не удалось вернуть бонусы', err),
          );
      }
      // 2) Откатить использование промокода.
      if (promoConsumed && dto.promoCode) {
        await this.promocodes
          .release(dto.companyId, dto.promoCode)
          .catch((err) =>
            console.error(
              'quickSale rollback: не удалось откатить промокод',
              err,
            ),
          );
      }
      // 3) Вернуть товар на склад и отменить заказ.
      await this.refund(order.id, userId).catch((err) =>
        console.error('quickSale rollback: не удалось отменить заказ', err),
      );
      // 4) Освободить ключ идемпотентности: иначе повтор оплаты вернул бы
      // ОТМЕНЁННЫЙ заказ как «успешный чек» (деньги не проведены, товар не списан).
      if (dto.idempotencyKey) {
        await this.prisma.order
          .update({
            where: { id: order.id },
            data: { idempotencyKey: null },
          })
          .catch((err) =>
            console.error('quickSale rollback: не удалось очистить ключ', err),
          );
      }
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
  // Отменяет заказ, сторнирует оплаты (отрицательные Payment по тем же способам)
  // и возвращает на склад только реально списанный товар.
  // companyId (из токена) — нельзя вернуть чужой заказ.
  async refund(orderId: string, userId?: string, companyId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Атомарный замок от двойного возврата (гонка read-then-act): CANCELLED
      // ставится сразу; параллельная транзакция получит count=0 и откажет.
      const locked = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { not: OrderStatus.CANCELLED },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
        data: { status: OrderStatus.CANCELLED },
      });
      if (locked.count === 0) {
        throw new BadRequestException('Заказ не найден или уже отменён');
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: true,
          payments: { where: { deletedAt: null } },
        },
      });

      // 1. Сторно оплат: отрицательный Payment по каждому способу (нетто с учётом
      // прошлых частичных возвратов). Касса и все отчёты считают выручку из
      // Payment — возврат уменьшает её тем же способом, а наличная часть
      // автоматически уменьшает расчётный остаток кассового ящика в Z-отчёте.
      const netByMethod = new Map<PaymentMethod, number>();
      for (const p of order.payments) {
        netByMethod.set(
          p.method,
          Number(
            ((netByMethod.get(p.method) ?? 0) + Number(p.amount)).toFixed(2),
          ),
        );
      }
      const shiftId = await this.openShiftId(tx, order.companyId, userId);
      for (const [method, net] of netByMethod) {
        if (net <= 0) continue;
        await tx.payment.create({
          data: {
            companyId: order.companyId,
            orderId: order.id,
            shiftId,
            userId,
            amount: -net,
            method,
          },
        });
      }

      // 2. Возврат товаров на склад — только то, что реально списывалось по этому
      // заказу (по движениям склада) и ещё не вернулось прошлыми возвратами.
      // Печатные заказы без списания склад не «пополняют» из воздуха.
      if (order.branchId) {
        const decremented = await this.decrementedByProduct(tx, orderId);
        for (const it of order.items) {
          if (it.itemType !== ItemType.PRODUCT || !it.productId) continue;
          const remaining = Math.max(0, decremented.get(it.productId) ?? 0);
          const restock = Number(
            Math.min(Number(it.quantity), remaining).toFixed(3),
          );
          if (restock <= 0) continue;
          decremented.set(
            it.productId,
            Number((remaining - restock).toFixed(3)),
          );
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

      // 3. Сторнируем начисленные бонусы (процент с каждой реальной оплаты, см.
      //    addPayment). Отрицательные Payment прошлых возвратов уже в сумме —
      //    вычитаем ровно то, что осталось начисленным.
      if (order.clientId) {
        const { accrual } = await this.bonusRates(order.companyId);
        const earned = order.payments
          .filter((p) => p.method !== PaymentMethod.DEBT)
          .reduce(
            (s, p) => s + Number((Number(p.amount) * accrual).toFixed(2)),
            0,
          );
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

      // 4. Останавливаем производство и дизайн — отменённый заказ не должен
      //    печататься и расходовать материалы.
      await tx.productionJob.updateMany({
        where: {
          orderId,
          deletedAt: null,
          status: {
            notIn: [ProductionStatus.COMPLETED, ProductionStatus.CANCELLED],
          },
        },
        data: { status: ProductionStatus.CANCELLED },
      });
      await tx.designProof.updateMany({
        where: {
          orderId,
          deletedAt: null,
          status: { notIn: [ProofStatus.APPROVED, ProofStatus.REJECTED] },
        },
        data: {
          status: ProofStatus.REJECTED,
          comment: 'Заказ отменён (возврат)',
        },
      });

      // 5. Обнуляем оплату/долг (деньги возвращены, отменённый заказ не должен
      //    висеть в долгах клиента) и пишем историю статуса. paymentStatus
      //    сбрасываем в UNPAID, иначе заказ остался бы помечен «оплачен».
      await tx.order.update({
        where: { id: orderId },
        data: { paid: 0, balanceDue: 0, paymentStatus: PaymentStatus.UNPAID },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: OrderStatus.CANCELLED,
          userId,
          reason: 'Полный возврат',
        },
      });

      return this.loadFull(tx, orderId);
    });
  }

  // Сколько товара реально списано со склада по заказу (нетто: списания минус
  // уже возвращённое) — по журналу движений склада.
  private async decrementedByProduct(
    tx: Prisma.TransactionClient,
    orderId: string,
  ) {
    const moves = await tx.stockMovement.findMany({
      where: { orderId, deletedAt: null },
      select: { productId: true, type: true, quantity: true },
    });
    const net = new Map<string, number>();
    for (const m of moves) {
      const q = Number(m.quantity);
      const cur = net.get(m.productId) ?? 0;
      if (m.type === StockMovementType.OUT) {
        net.set(m.productId, Number((cur + q).toFixed(3)));
      } else if (
        m.type === StockMovementType.IN ||
        m.type === StockMovementType.RETURN
      ) {
        net.set(m.productId, Number((cur - q).toFixed(3)));
      }
    }
    return net;
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
    return this.prisma.$transaction(async (tx) => {
      // Замок строки заказа: параллельные возвраты/refund сериализуются на этом
      // update (row lock до конца транзакции), гонка read-then-act невозможна.
      const locked = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { not: OrderStatus.CANCELLED },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0) {
        throw new BadRequestException(
          'Заказ не найден или отменён — возврат невозможен',
        );
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, payments: { where: { deletedAt: null } } },
      });

      // Сколько уже возвращено по каждой позиции (из прошлых документов возврата),
      // чтобы нельзя было вернуть больше, чем реально продано (двойной возврат).
      const priorReturns = await tx.return.findMany({
        where: { orderId },
        select: { items: true },
      });
      const returnedByItem = new Map<string, number>();
      for (const r of priorReturns) {
        for (const li of (r.items as any[]) ?? []) {
          if (li?.orderItemId) {
            returnedByItem.set(
              li.orderItemId,
              (returnedByItem.get(li.orderItemId) ?? 0) +
                Number(li.quantity || 0),
            );
          }
        }
      }

      let amount = 0;
      let returnedCost = 0;
      const returned: any[] = [];
      // Нетто-списание со склада по заказу — приходуем не больше, чем реально
      // списывалось (печатный заказ без списания склад не «пополняет»).
      const decremented = await this.decrementedByProduct(tx, orderId);

      for (const ri of dto.items) {
        const oi = order.items.find((x) => x.id === ri.orderItemId);
        if (!oi) continue;
        // Остаток к возврату по позиции = продано − уже возвращено.
        const alreadyReturned = returnedByItem.get(oi.id) ?? 0;
        const remaining = Number(oi.quantity) - alreadyReturned;
        const qty = Math.min(Number(ri.quantity), remaining);
        if (qty <= 0) continue;
        const lineAmount = Number((qty * Number(oi.unitPrice)).toFixed(2));
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

        // Товар — возвращаем на склад (приход RETURN с аудитом до/после),
        // но не больше фактически списанного по этому заказу
        if (
          oi.itemType === ItemType.PRODUCT &&
          oi.productId &&
          order.branchId
        ) {
          const decRemaining = Math.max(0, decremented.get(oi.productId) ?? 0);
          const restock = Number(Math.min(qty, decRemaining).toFixed(3));
          if (restock <= 0) continue;
          decremented.set(
            oi.productId,
            Number((decRemaining - restock).toFixed(3)),
          );
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
              quantity: restock,
            },
            update: { quantity: { increment: restock } },
          });
          await tx.stockMovement.create({
            data: {
              companyId: order.companyId,
              productId: oi.productId,
              branchId: order.branchId,
              type: StockMovementType.RETURN,
              quantity: restock,
              beforeQty: before,
              afterQty: Number((before + restock).toFixed(3)),
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

      // Сторно оплат: отрицательные Payment по способам. Наличные — в первую
      // очередь (деньги выдаются из ящика, Z-отчёт уменьшит расчётный остаток),
      // остаток — по безналичным способам, которыми платили.
      const netBy = (m: PaymentMethod) =>
        Number(
          order.payments
            .filter((p) => p.method === m)
            .reduce((s, p) => s + Number(p.amount), 0)
            .toFixed(2),
        );
      const shiftId = await this.openShiftId(tx, order.companyId, userId);
      let moneyLeft = moneyBack;
      for (const m of [
        PaymentMethod.CASH,
        PaymentMethod.CARD,
        PaymentMethod.QR,
        PaymentMethod.TRANSFER,
      ]) {
        if (moneyLeft <= 0) break;
        const take = Number(
          Math.min(moneyLeft, Math.max(0, netBy(m))).toFixed(2),
        );
        if (take <= 0) continue;
        await tx.payment.create({
          data: {
            companyId: order.companyId,
            orderId: order.id,
            shiftId,
            userId,
            amount: -take,
            method: m,
          },
        });
        moneyLeft = Number((moneyLeft - take).toFixed(2));
      }
      // Долговая часть возврата уменьшает маркер «в долг» (строка Z-отчёта),
      // чтобы возврат долговой продажи не оставлял завышенный долг в отчётах.
      const debtPart = Number(
        Math.min(
          amount - moneyBack,
          Math.max(0, netBy(PaymentMethod.DEBT)),
        ).toFixed(2),
      );
      if (debtPart > 0) {
        await tx.payment.create({
          data: {
            companyId: order.companyId,
            orderId: order.id,
            shiftId,
            userId,
            amount: -debtPart,
            method: PaymentMethod.DEBT,
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
          method: dto.method,
          items: returned,
          userId,
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
      await tx.order.update({
        where: { id: orderId },
        data: {
          returnedTotal: newReturnedTotal,
          returnedCost: newReturnedCost,
          paid: newPaid,
          balanceDue: Number(
            Math.max(
              0,
              Number(order.total) - newReturnedTotal - newPaid,
            ).toFixed(2),
          ),
        },
      });

      // Сторнируем начисленные бонусы пропорционально реально возвращённым деньгам
      // (по той же ставке, что при начислении), чтобы возврат не оставлял «лишних» баллов.
      if (order.clientId && moneyBack > 0) {
        const { accrual } = await this.bonusRates(order.companyId);
        const earned = Number((moneyBack * accrual).toFixed(2));
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

    // Матрица допустимых переходов (ручная смена статуса). Вперёд по цепочке —
    // свободно (в т.ч. быстрые продажи ACCEPTED→DELIVERED); назад — ограниченно;
    // из DELIVERED — только в REWORK (переделка/возврат), иначе выданный заказ
    // «уехал бы» обратно в работу. Авто-синхронизация из производства идёт мимо
    // этого метода (прямой update), поэтому её матрица не блокирует.
    const FLOW: Record<OrderStatus, OrderStatus[]> = {
      ACCEPTED: [
        OrderStatus.AWAITING_DESIGN,
        OrderStatus.IN_DESIGN,
        OrderStatus.DESIGN_APPROVED,
        OrderStatus.IN_PROGRESS,
        OrderStatus.READY,
        OrderStatus.DELIVERED,
      ],
      AWAITING_DESIGN: [
        OrderStatus.ACCEPTED,
        OrderStatus.IN_DESIGN,
        OrderStatus.DESIGN_APPROVAL,
        OrderStatus.DESIGN_APPROVED,
        OrderStatus.IN_PROGRESS,
      ],
      IN_DESIGN: [
        OrderStatus.AWAITING_DESIGN,
        OrderStatus.DESIGN_APPROVAL,
        OrderStatus.DESIGN_APPROVED,
        OrderStatus.IN_PROGRESS,
        OrderStatus.REWORK,
      ],
      DESIGN_APPROVAL: [
        OrderStatus.IN_DESIGN,
        OrderStatus.DESIGN_APPROVED,
        OrderStatus.IN_PROGRESS,
        OrderStatus.REWORK,
      ],
      DESIGN_APPROVED: [
        OrderStatus.IN_DESIGN,
        OrderStatus.IN_PROGRESS,
        OrderStatus.READY,
        OrderStatus.REWORK,
      ],
      IN_PROGRESS: [
        OrderStatus.DESIGN_APPROVED,
        OrderStatus.READY,
        OrderStatus.DELIVERED,
        OrderStatus.REWORK,
      ],
      READY: [
        OrderStatus.IN_PROGRESS,
        OrderStatus.DELIVERED,
        OrderStatus.REWORK,
      ],
      DELIVERED: [OrderStatus.REWORK],
      REWORK: [
        OrderStatus.ACCEPTED,
        OrderStatus.IN_DESIGN,
        OrderStatus.DESIGN_APPROVED,
        OrderStatus.IN_PROGRESS,
        OrderStatus.READY,
      ],
      CANCELLED: [],
    };
    if (!FLOW[order.status]?.includes(status)) {
      throw new BadRequestException(
        `Недопустимый переход статуса: «${order.status}» → «${status}»`,
      );
    }

    // Барьер согласования: заказ с макетом не уходит в производство, пока макет
    // не утверждён (профильный риск типографии — тираж по несогласованному файлу).
    if (status === OrderStatus.IN_PROGRESS) {
      await this.ensureDesignApproved(order.companyId, orderId);
    }

    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status } }),
      this.prisma.orderStatusHistory.create({
        data: { orderId, status, userId, reason },
      }),
    ]);

    // Авто-создание задания производства при переходе в «В производстве»,
    // если для заказа его ещё нет (ТЗ п.11: согласование → производство).
    if (status === OrderStatus.IN_PROGRESS) {
      const existing = await this.prisma.productionJob.findFirst({
        where: { orderId, deletedAt: null },
      });
      if (!existing) {
        await this.prisma.productionJob.create({
          data: {
            companyId: order.companyId,
            orderId,
            assignedUserId: order.operatorId ?? undefined,
          },
        });
      }
    }

    // Уведомление о готовности заказа: Telegram + email клиенту.
    // Тумблер notifyOrderReady выключает рассылку целиком (С1/П2 аудита).
    if (status === OrderStatus.READY) {
      const notif = await this.prisma.setting.findFirst({
        where: { companyId: order.companyId, key: 'notifyOrderReady' },
      });
      if (notif?.value === 'false' || notif?.value === '0') {
        return this.findOne(orderId);
      }
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

  // Редактирование полей заказа (без позиций/сумм — те влияют на деньги/склад).
  // Поле, которого нет в запросе (undefined) — не трогаем; пустое → снять значение.
  async updateFields(
    orderId: string,
    dto: {
      assignedUserId?: string | null;
      designerId?: string | null;
      operatorId?: string | null;
      format?: string | null;
      colorMode?: string | null;
      urgency?: OrderUrgency;
      deadline?: string | null;
      note?: string | null;
    },
    companyId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.companyId !== companyId) {
      throw new NotFoundException('Заказ не найден');
    }
    const nn = (v: string | null | undefined) =>
      v === undefined ? undefined : v || null;
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        assignedUserId: nn(dto.assignedUserId),
        designerId: nn(dto.designerId),
        operatorId: nn(dto.operatorId),
        format: nn(dto.format),
        colorMode: nn(dto.colorMode),
        urgency: dto.urgency,
        deadline:
          dto.deadline === undefined
            ? undefined
            : dto.deadline
              ? new Date(dto.deadline)
              : null,
        note: nn(dto.note),
      },
    });
    return this.findOne(orderId, companyId);
  }

  // Прикрепить файл (макет/документ) к заказу
  async addFile(
    orderId: string,
    fileUrl: string,
    companyId: string,
    fileName?: string,
    type?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { companyId: true },
    });
    if (!order || order.companyId !== companyId) {
      throw new NotFoundException('Заказ не найден');
    }
    return this.prisma.orderFile.create({
      data: { orderId, fileUrl, fileName, type },
    });
  }

  async removeFile(fileId: string, companyId: string) {
    const file = await this.prisma.orderFile.findUnique({
      where: { id: fileId },
      include: { order: { select: { companyId: true } } },
    });
    if (!file || file.order.companyId !== companyId) {
      throw new NotFoundException('Файл не найден');
    }
    await this.prisma.orderFile.delete({ where: { id: fileId } });
    return { ok: true };
  }

  // Ставки бонусной программы из настроек компании (в долях).
  // По умолчанию: начисление 1%, максимум списания 30% от чека.
  // Барьер согласования макета: если у заказа есть активные макеты и ни один
  // не утверждён — старт производства запрещён. Отключается настройкой
  // requireDesignApproval = '0'. Заказы без макетов (быстрые продажи) не трогаем.
  async ensureDesignApproved(companyId: string, orderId: string) {
    const setting = await this.prisma.setting.findFirst({
      where: { companyId, key: 'requireDesignApproval' },
    });
    if (setting?.value === '0') return;
    const proofs = await this.prisma.designProof.findMany({
      where: { orderId, deletedAt: null },
      select: { status: true },
    });
    // Считаем активными все макеты, кроме отклонённых. Печать разрешена только
    // когда КАЖДЫЙ активный макет согласован (а не «хотя бы один»): иначе тираж
    // мог бы уйти по несогласованной второй стороне/версии.
    const active = proofs.filter((p) => p.status !== ProofStatus.REJECTED);
    if (active.length === 0) return;
    if (active.every((p) => p.status === ProofStatus.APPROVED)) return;
    throw new BadRequestException(
      'Не все макеты заказа согласованы — запуск производства заблокирован. ' +
        'Утвердите все макеты (статус «Согласован») или отключите барьер в настройках.',
    );
  }

  // Есть ли у пользователя указанное право — для условных проверок в сервисе
  // (например «скидка сверх лимита»). Пустой userId => прав нет.
  private async userHasPermission(
    userId: string | undefined,
    code: string,
  ): Promise<boolean> {
    if (!userId) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { roleId: true },
    });
    if (!user?.roleId) return false;
    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId: user.roleId, permission: { code } },
      select: { id: true },
    });
    return !!rp;
  }

  private async bonusRates(
    companyId: string,
  ): Promise<{ accrual: number; maxRedeem: number }> {
    const rows = await this.prisma.setting.findMany({
      where: {
        companyId,
        key: { in: ['bonusAccrualPercent', 'bonusMaxRedeemPercent'] },
      },
    });
    const num = (key: string, def: number) => {
      const v = rows.find((r) => r.key === key)?.value;
      const n = v != null && v !== '' ? Number(v) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : def;
    };
    return {
      accrual: num('bonusAccrualPercent', 1) / 100,
      maxRedeem: num('bonusMaxRedeemPercent', 30) / 100,
    };
  }

  // ---------- Списки и чтение ----------
  // Общий конструктор условий выборки заказов из фильтров.
  private buildWhere(
    companyId: string,
    f: OrderFilters,
  ): Prisma.OrderWhereInput {
    return {
      companyId,
      deletedAt: null,
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
