import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DiscountType,
  ItemType,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  StockMovementType,
} from '@prisma/client';
import { OrdersService } from './orders.service';

/**
 * Юнит-тесты бизнес-правил OrdersService (деньги/возвраты/статусы/арендаторы).
 *
 * Сервис работает целиком внутри prisma.$transaction(async (tx) => …). Поэтому
 * мокаем $transaction так, что он ПРОСТО вызывает переданный колбэк с фейковым
 * `tx`, а модели tx — jest.fn с настраиваемыми ответами. Так проверяется РЕАЛЬНАЯ
 * логика сервиса: какие запросы он выдаёт, как считает деньги/возвраты, какие
 * инварианты держит (переплата, кэп налички, нетто-цены, DEBT, терминальные статусы,
 * tenant-изоляция). order-math.spec.ts уже покрывает чистую математику — здесь мы
 * покрываем сборку сценариев в сервисе и НЕ дублируем его.
 *
 * Гарантии, требующие ЖИВОЙ БД (реальный откат транзакции, unique-индексы под
 * гонкой, optimistic-lock под конкуренцией), вынесены в it.todo ниже — на моках
 * они непроверяемы честно.
 */

const COMPANY_A = 'company-A';
const COMPANY_B = 'company-B';
const USER = 'cashier-1';

type AnyMock = jest.Mock<any, any>;

// Фейковый транзакционный клиент: все модели/методы, к которым обращается сервис.
function makeTx() {
  return {
    order: {
      findUnique: jest.fn() as AnyMock,
      create: jest.fn() as AnyMock,
      update: jest.fn() as AnyMock,
      updateMany: jest.fn() as AnyMock,
      aggregate: jest.fn() as AnyMock,
    },
    client: {
      findFirst: jest.fn() as AnyMock,
      findUnique: jest.fn() as AnyMock,
      create: jest.fn() as AnyMock,
      update: jest.fn() as AnyMock,
      updateMany: jest.fn() as AnyMock,
    },
    branch: { findFirst: jest.fn() as AnyMock },
    service: { findMany: jest.fn() as AnyMock },
    product: { findMany: jest.fn() as AnyMock },
    user: { count: jest.fn() as AnyMock },
    setting: { findMany: jest.fn() as AnyMock },
    payment: { findUnique: jest.fn() as AnyMock, create: jest.fn() as AnyMock },
    cashShift: { findFirst: jest.fn() as AnyMock },
    cashMovement: { create: jest.fn() as AnyMock },
    stock: {
      findUnique: jest.fn() as AnyMock,
      updateMany: jest.fn() as AnyMock,
      upsert: jest.fn() as AnyMock,
    },
    stockMovement: { create: jest.fn() as AnyMock },
    promoCode: { findFirst: jest.fn() as AnyMock, updateMany: jest.fn() as AnyMock },
    return: {
      findMany: jest.fn() as AnyMock,
      aggregate: jest.fn() as AnyMock,
      create: jest.fn() as AnyMock,
    },
    orderStatusHistory: { create: jest.fn() as AnyMock },
    $queryRaw: jest.fn() as AnyMock,
    $executeRaw: jest.fn() as AnyMock,
  };
}
type Tx = ReturnType<typeof makeTx>;

// PrismaService-мок: $transaction прогоняет колбэк с нашим tx; плюс прямые
// (нетранзакционные) методы, которые сервис вызывает вне транзакции.
function makePrisma(tx: Tx) {
  return {
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') return arg(tx);
      throw new Error('array form of $transaction not used in these tests');
    }) as AnyMock,
    order: { findUnique: jest.fn() as AnyMock },
    return: { findUnique: jest.fn() as AnyMock },
    client: { findUnique: jest.fn() as AnyMock },
    user: { findMany: jest.fn() as AnyMock },
  };
}

function makeDeps() {
  return {
    telegram: { send: jest.fn().mockResolvedValue(true) as AnyMock },
    promocodes: {}, // не используется (промо консумится через tx.promoCode)
    email: { send: jest.fn().mockResolvedValue(undefined) as AnyMock },
    audit: { recordTx: jest.fn().mockResolvedValue(undefined) as AnyMock },
  };
}

// Заказ в форме, которую возвращает Prisma (числа вместо Decimal — сервис делает
// Number(...) поверх, так что plain-числа честно проходят ту же логику).
function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    companyId: COMPANY_A,
    branchId: null,
    clientId: null,
    orderNumber: 'ORD-C-2026-000001',
    orderType: OrderType.SALE,
    status: OrderStatus.ACCEPTED,
    total: 100,
    paid: 0,
    balanceDue: 100,
    returnedTotal: 0,
    returnedCost: 0,
    paymentStatus: PaymentStatus.UNPAID,
    items: [],
    payments: [],
    statusHistory: [],
    ...overrides,
  };
}

describe('OrdersService — деньги/возвраты/статусы/арендаторы (моки Prisma)', () => {
  let tx: Tx;
  let prisma: ReturnType<typeof makePrisma>;
  let deps: ReturnType<typeof makeDeps>;
  let service: OrdersService;
  let orderRow: Record<string, any>;

  beforeEach(() => {
    orderRow = makeOrder();
    tx = makeTx();
    prisma = makePrisma(tx);
    deps = makeDeps();
    service = new OrdersService(
      prisma as never,
      deps.telegram as never,
      deps.promocodes as never,
      deps.email as never,
      deps.audit as never,
    );

    // Поиск заказа: idempotency-предпроверки (по ключу) промахиваются, поиск по id
    // возвращает текущий orderRow (его тест переопределяет ДО вызова сервиса).
    tx.order.findUnique.mockImplementation(async (args: any) =>
      args?.where?.idempotencyKey !== undefined ? null : orderRow,
    );
    prisma.order.findUnique.mockImplementation(async (args: any) =>
      args?.where?.idempotencyKey !== undefined ? null : orderRow,
    );

    tx.order.create.mockResolvedValue({ id: 'order-1' });
    tx.order.update.mockResolvedValue({});
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.order.aggregate.mockResolvedValue({ _sum: { balanceDue: 0 } });

    // client.findFirst обслуживает два разных запроса: поиск по телефону в
    // createOrderTx (нет → создаём) и чтение баллов по id для списания бонусов.
    tx.client.findFirst.mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      if (w.phone !== undefined) return null;
      if (w.id !== undefined) return { bonusPoints: 1000 };
      return null;
    });
    tx.client.findUnique.mockResolvedValue({ creditLimit: 0 });
    tx.client.create.mockResolvedValue({ id: 'client-1' });
    tx.client.update.mockResolvedValue({});
    tx.client.updateMany.mockResolvedValue({ count: 1 });

    tx.branch.findFirst.mockResolvedValue({ id: 'branch-1' });
    tx.service.findMany.mockResolvedValue([]);
    tx.product.findMany.mockResolvedValue([]);
    tx.user.count.mockResolvedValue(1);
    tx.setting.findMany.mockResolvedValue([]);

    tx.payment.findUnique.mockResolvedValue(null);
    tx.payment.create.mockResolvedValue({ id: 'pay-1' });

    tx.cashShift.findFirst.mockResolvedValue({ id: 'shift-1' });
    tx.cashMovement.create.mockResolvedValue({});

    tx.stock.findUnique.mockResolvedValue({ quantity: 100 });
    tx.stock.updateMany.mockResolvedValue({ count: 1 });
    tx.stock.upsert.mockResolvedValue({});
    tx.stockMovement.create.mockResolvedValue({});

    tx.promoCode.findFirst.mockResolvedValue({
      id: 'promo-1',
      discountType: DiscountType.PERCENT,
      value: 10,
      isActive: true,
      usedCount: 0,
      maxUses: null,
      validUntil: null,
    });
    tx.promoCode.updateMany.mockResolvedValue({ count: 1 });

    tx.return.findMany.mockResolvedValue([]);
    tx.return.aggregate.mockResolvedValue({ _sum: { cashRefunded: 0 } });
    tx.return.create.mockResolvedValue({ id: 'ret-1' });

    tx.orderStatusHistory.create.mockResolvedValue({});
    tx.$queryRaw.mockResolvedValue([{ value: 1 }]); // nextSeq
    tx.$executeRaw.mockResolvedValue(undefined); // FOR UPDATE / списание бонусов

    prisma.return.findUnique.mockResolvedValue(null);
    prisma.client.findUnique.mockResolvedValue({ email: null, fullName: null });
    prisma.user.findMany.mockResolvedValue([]);
  });

  // ─────────────────────────────── addPayment ───────────────────────────────
  describe('addPayment — переплата, идемпотентность, смена, бонусы, tenant', () => {
    it('способ «В долг» нельзя провести как оплату → BadRequest ещё ДО транзакции', async () => {
      await expect(
        service.addPayment(
          'order-1',
          { amount: 50, method: PaymentMethod.DEBT },
          USER,
          COMPANY_A,
        ),
      ).rejects.toThrow(BadRequestException);
      // до $transaction дело не доходит — долг не «оплачивается»
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('IDOR: заказ чужой компании → NotFound, платёж не создаётся', async () => {
      orderRow = makeOrder({ companyId: COMPANY_A, total: 100, paid: 0 });
      await expect(
        service.addPayment(
          'order-1',
          { amount: 50, method: PaymentMethod.CASH },
          USER,
          COMPANY_B, // из чужого токена
        ),
      ).rejects.toThrow(NotFoundException);
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('запрет переплаты: оплата больше остатка → BadRequest, ни платежа, ни апдейта', async () => {
      orderRow = makeOrder({ total: 100, paid: 0, returnedTotal: 0 });
      await expect(
        service.addPayment(
          'order-1',
          { amount: 150, method: PaymentMethod.CASH },
          USER,
          COMPANY_A,
        ),
      ).rejects.toThrow(/остаток/i);
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('остаток к оплате считается от нетто (total − возвращённое): оплата выше него отклоняется', async () => {
      // total 100, но 30 уже возвращено → эффективный остаток 70; 80 > 70 → отказ (P0-3)
      orderRow = makeOrder({ total: 100, paid: 0, returnedTotal: 30 });
      await expect(
        service.addPayment(
          'order-1',
          { amount: 80, method: PaymentMethod.CASH },
          USER,
          COMPANY_A,
        ),
      ).rejects.toThrow(/остаток/i);
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('заказ уже полностью оплачен → BadRequest', async () => {
      orderRow = makeOrder({ total: 100, paid: 100 });
      await expect(
        service.addPayment(
          'order-1',
          { amount: 10, method: PaymentMethod.CASH },
          USER,
          COMPANY_A,
        ),
      ).rejects.toThrow(/полностью оплачен/i);
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('нет открытой смены → BadRequest, платёж не проводится', async () => {
      orderRow = makeOrder({ total: 100, paid: 0 });
      tx.cashShift.findFirst.mockResolvedValue(null); // смены нет
      await expect(
        service.addPayment(
          'order-1',
          { amount: 50, method: PaymentMethod.CASH },
          USER,
          COMPANY_A,
        ),
      ).rejects.toThrow(/cash shift/i);
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('идемпотентность: повтор того же ключа → второй платёж НЕ создаётся', async () => {
      orderRow = makeOrder({ total: 100, paid: 0 });
      tx.payment.findUnique.mockResolvedValue({
        id: 'pay-existing',
        orderId: 'order-1',
      });
      await service.addPayment(
        'order-1',
        { amount: 50, method: PaymentMethod.CASH, idempotencyKey: 'key-1' },
        USER,
        COMPANY_A,
      );
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('happy частичная: платёж создан, заказ → PARTIAL, начислен 1% бонуса', async () => {
      orderRow = makeOrder({ total: 100, paid: 0, clientId: 'client-1' });
      await service.addPayment(
        'order-1',
        { amount: 60, method: PaymentMethod.CASH },
        USER,
        COMPANY_A,
      );
      const upd = tx.order.updateMany.mock.calls[0][0];
      // оптимистичная блокировка по прочитанному paid
      expect(upd.where).toEqual(expect.objectContaining({ id: 'order-1', paid: 0 }));
      expect(upd.data.paid).toBe(60);
      expect(upd.data.balanceDue).toBe(40);
      expect(upd.data.paymentStatus).toBe(PaymentStatus.PARTIAL);

      const pay = tx.payment.create.mock.calls[0][0].data;
      expect(pay.amount).toBe(60);
      expect(pay.method).toBe(PaymentMethod.CASH);

      // бонус клиенту = 1% с внесённой суммы
      expect(tx.client.update.mock.calls[0][0].data.bonusPoints).toEqual({
        increment: 0.6,
      });
    });

    it('внесли ровно остаток → PAID, balanceDue = 0', async () => {
      orderRow = makeOrder({ total: 100, paid: 0 });
      await service.addPayment(
        'order-1',
        { amount: 100, method: PaymentMethod.CARD },
        USER,
        COMPANY_A,
      );
      const upd = tx.order.updateMany.mock.calls[0][0].data;
      expect(upd.paid).toBe(100);
      expect(upd.balanceDue).toBe(0);
      expect(upd.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('optimistic-lock: заказ изменился параллельно (count=0) → отказ, платёж НЕ создаётся', async () => {
      orderRow = makeOrder({ total: 100, paid: 0 });
      tx.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.addPayment(
          'order-1',
          { amount: 50, method: PaymentMethod.CASH },
          USER,
          COMPANY_A,
        ),
      ).rejects.toThrow(/изменил/i);
      // платёж создаётся ТОЛЬКО после успешного апдейта — иначе «висящий» платёж
      expect(tx.payment.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────── quickSale ───────────────────────────────
  describe('quickSale — сборка продажи в одной транзакции', () => {
    const saleItems = [
      { itemType: ItemType.SERVICE, description: 'Печать', quantity: 1, unitPrice: 100 },
    ];

    it('продажа «в долг»: paymentStatus=DEBT + Payment(method=DEBT), без движения денег и бонусов', async () => {
      orderRow = makeOrder({ clientId: 'client-1', total: 100 });
      await service.quickSale(
        {
          companyId: COMPANY_A,
          method: PaymentMethod.DEBT,
          clientPhone: '+992900000000',
          items: saleItems,
        } as never,
        USER,
      );

      const debtPay = tx.payment.create.mock.calls.find(
        (c) => c[0].data.method === PaymentMethod.DEBT,
      );
      expect(debtPay).toBeDefined();
      expect(debtPay![0].data.amount).toBe(100);

      const debtStatus = tx.order.update.mock.calls.find(
        (c) => c[0].data?.paymentStatus === PaymentStatus.DEBT,
      );
      expect(debtStatus).toBeDefined();

      // долг — не оплата: реального проведения оплаты (addPaymentTx) нет,
      // бонусы за долг не начисляются
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(tx.client.update).not.toHaveBeenCalled();

      // и всё же чек выдан (DELIVERED)
      expect(
        tx.order.update.mock.calls.find(
          (c) => c[0].data?.status === OrderStatus.DELIVERED,
        ),
      ).toBeDefined();
    });

    it('долг требует клиента: method=DEBT без телефона → BadRequest ДО транзакции', async () => {
      await expect(
        service.quickSale(
          { companyId: COMPANY_A, method: PaymentMethod.DEBT, items: saleItems } as never,
          USER,
        ),
      ).rejects.toThrow(/client is required/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('DEBT нельзя как часть смешанной оплаты → BadRequest ДО транзакции', async () => {
      await expect(
        service.quickSale(
          {
            companyId: COMPANY_A,
            payments: [{ method: PaymentMethod.DEBT, amount: 100 }],
            items: saleItems,
          } as never,
          USER,
        ),
      ).rejects.toThrow(/mixed payment/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('товары без филиала продавать нельзя → BadRequest ДО транзакции', async () => {
      await expect(
        service.quickSale(
          {
            companyId: COMPANY_A,
            items: [
              { itemType: ItemType.PRODUCT, productId: 'prd-1', quantity: 1, unitPrice: 50 },
            ],
          } as never,
          USER,
        ),
      ).rejects.toThrow(/branch/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('сумма частей смешанной оплаты обязана совпасть с итогом → иначе BadRequest', async () => {
      orderRow = makeOrder({ total: 100 });
      await expect(
        service.quickSale(
          {
            companyId: COMPANY_A,
            payments: [
              { method: PaymentMethod.CASH, amount: 50 },
              { method: PaymentMethod.CARD, amount: 30 }, // 80 ≠ 100
            ],
            items: saleItems,
          } as never,
          USER,
        ),
      ).rejects.toThrow(/match sale total/i);
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('атомарность: при сбое оплаты промокод/бонусы менялись через ТОТ ЖЕ tx (живой Postgres откатит всё)', async () => {
      orderRow = makeOrder({ clientId: 'client-1', total: 100 });
      tx.cashShift.findFirst.mockResolvedValue(null); // оплата упадёт: смены нет

      await expect(
        service.quickSale(
          {
            companyId: COMPANY_A,
            clientPhone: '+992900000000',
            method: PaymentMethod.CASH,
            discount: 20,
            promoCode: 'SALE10',
            useBonus: 30,
            items: saleItems,
          } as never,
          USER,
        ),
      ).rejects.toThrow(/cash shift/i);

      // Промокод израсходован (usedCount++) и бонусы списаны — но ОБА через
      // транзакционный клиент tx, который затем бросил. Реальный Postgres
      // откатит их вместе с заказом (сам откат — it.todo для живой БД).
      expect(tx.promoCode.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.client.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.client.updateMany.mock.calls[0][0].data.bonusPoints).toEqual({
        decrement: 21.6, // min(30, 1000, 30%×72, 72) от остатка после ручной скидки и промо
      });
    });

    it('заказ обнулён ручной скидкой → промокод НЕ жжётся и бонусы НЕ списываются (finding 601)', async () => {
      orderRow = makeOrder({ clientId: 'client-1', total: 100 });
      await service.quickSale(
        {
          companyId: COMPANY_A,
          clientPhone: '+992900000000',
          method: PaymentMethod.CASH,
          discount: 100, // обнуляет остаток
          promoCode: 'SALE10',
          useBonus: 50,
          items: saleItems,
        } as never,
        USER,
      );
      expect(tx.promoCode.updateMany).not.toHaveBeenCalled();
      expect(tx.client.updateMany).not.toHaveBeenCalled();
      // бесплатный заказ закрывается как PAID (paid=0)
      expect(
        tx.order.update.mock.calls.find(
          (c) => c[0].data?.paymentStatus === PaymentStatus.PAID,
        ),
      ).toBeDefined();
    });

    it('happy CASH: одна транзакция, оплата + 1% бонуса, статус DELIVERED и номер чека', async () => {
      orderRow = makeOrder({ clientId: 'client-1', total: 100 });
      await service.quickSale(
        {
          companyId: COMPANY_A,
          clientPhone: '+992900000000',
          method: PaymentMethod.CASH,
          items: saleItems,
        } as never,
        USER,
      );

      // вся сборка — в ОДНОЙ транзакции
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const cashPay = tx.payment.create.mock.calls.find(
        (c) => c[0].data.method === PaymentMethod.CASH,
      );
      expect(cashPay![0].data.amount).toBe(100);

      const paid = tx.order.updateMany.mock.calls.find(
        (c) => c[0].data?.paymentStatus === PaymentStatus.PAID,
      );
      expect(paid![0].data.paid).toBe(100);
      expect(paid![0].data.balanceDue).toBe(0);

      // 1% бонуса с оплаты
      expect(tx.client.update.mock.calls[0][0].data.bonusPoints).toEqual({
        increment: 1,
      });

      // выдан + присвоен номер чека POS-...
      const delivered = tx.order.update.mock.calls.find(
        (c) => c[0].data?.status === OrderStatus.DELIVERED,
      );
      expect(delivered![0].data.receiptNumber).toMatch(/^POS-/);
      // смена статуса записана в историю
      expect(
        tx.orderStatusHistory.create.mock.calls.find(
          (c) => c[0].data.status === OrderStatus.DELIVERED,
        ),
      ).toBeDefined();
    });
  });

  // ─────────────────────────── refund (полный возврат) ───────────────────────────
  describe('refund — нетто-возврат, кэп налички, restock, отмена', () => {
    it('IDOR: чужой заказ → NotFound, ни возврата, ни отмены', async () => {
      orderRow = makeOrder({
        companyId: COMPANY_A,
        status: OrderStatus.DELIVERED,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 0 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 100 }],
      });
      await expect(service.refund('order-1', USER, COMPANY_B)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.return.create).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('уже отменённый заказ → BadRequest', async () => {
      orderRow = makeOrder({ status: OrderStatus.CANCELLED });
      await expect(service.refund('order-1', USER, COMPANY_A)).rejects.toThrow(
        /отмен/i,
      );
    });

    it('P0-2: из ящика выдаём только наличную часть, безнал не трогает кассу', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 100,
        branchId: null,
        clientId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 0 },
        ],
        // 60 наличными + 40 картой
        payments: [
          { method: PaymentMethod.CASH, amount: 60 },
          { method: PaymentMethod.CARD, amount: 40 },
        ],
      });
      await service.refund('order-1', USER, COMPANY_A);

      const cashOut = tx.cashMovement.create.mock.calls[0][0].data;
      expect(cashOut.type).toBe('OUT');
      expect(cashOut.amount).toBe(60); // не 100 — карту наличными не выдаём

      const ret = tx.return.create.mock.calls[0][0].data;
      expect(ret.cashRefunded).toBe(60);
      expect(ret.amount).toBe(100); // товар/услуга вернулись полностью
    });

    it('P0-1: возврат считается от НЕТТО-цен (доля оплаты к валовым строкам)', async () => {
      // total 85 против валовых 100 → ratio 0.85; возврат строки = 100×0.85 = 85
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 85,
        paid: 85,
        branchId: null,
        clientId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 0 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 85 }],
      });
      await service.refund('order-1', USER, COMPANY_A);

      expect(tx.return.create.mock.calls[0][0].data.amount).toBe(85); // не 100
      expect(tx.order.updateMany.mock.calls[0][0].data.returnedTotal).toBe(85);
    });

    it('на склад возвращаем только НЕ возвращённое ранее (без двойного оприходования)', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 100,
        branchId: 'branch-1',
        clientId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.PRODUCT, productId: 'prd-1', serviceId: null, description: null, quantity: 5, unitPrice: 20, unitCost: 10 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 100 }],
      });
      // 2 из 5 уже вернули прошлым возвратом
      tx.return.findMany.mockResolvedValue([
        { items: [{ orderItemId: 'oi-1', quantity: 2 }] },
      ]);
      tx.stock.findUnique.mockResolvedValue({ quantity: 10 });

      await service.refund('order-1', USER, COMPANY_A);

      const mv = tx.stockMovement.create.mock.calls[0][0].data;
      expect(mv.type).toBe(StockMovementType.IN);
      expect(mv.quantity).toBe(3); // 5 − 2 = 3, не 5
      expect(tx.stock.upsert.mock.calls[0][0].update).toEqual({
        quantity: { increment: 3 },
      });
    });

    it('заказ меняется во время возврата (guard count=0) → BadRequest', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 100,
        branchId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 0 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 100 }],
      });
      tx.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.refund('order-1', USER, COMPANY_A)).rejects.toThrow(
        /order changed during refund/i,
      );
    });

    it('успешный возврат: заказ → CANCELLED, долг обнулён, запись в историю', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 100,
        branchId: null,
        clientId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 0 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 100 }],
      });
      await service.refund('order-1', USER, COMPANY_A);

      const upd = tx.order.updateMany.mock.calls[0][0].data;
      expect(upd.status).toBe(OrderStatus.CANCELLED);
      expect(upd.paid).toBe(0);
      expect(upd.balanceDue).toBe(0);
      expect(upd.paymentStatus).toBe(PaymentStatus.UNPAID);

      expect(
        tx.orderStatusHistory.create.mock.calls.find(
          (c) => c[0].data.status === OrderStatus.CANCELLED,
        ),
      ).toBeDefined();
    });
  });

  // ─────────────────────── createReturn (частичный возврат) ───────────────────────
  describe('createReturn — частичный возврат по чеку', () => {
    const oneItemDto = { items: [{ orderItemId: 'oi-1', quantity: 1 }] };

    it('пустой список позиций → BadRequest ДО транзакции', async () => {
      await expect(
        service.createReturn('order-1', { items: [] } as never, USER, COMPANY_A),
      ).rejects.toThrow(/выберите позиции/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('идемпотентность (P0-7): повтор ключа → возвращаем существующий документ без транзакции', async () => {
      prisma.return.findUnique.mockResolvedValue({ id: 'ret-existing' });
      const res = await service.createReturn(
        'order-1',
        { items: [{ orderItemId: 'oi-1', quantity: 1 }], idempotencyKey: 'k1' } as never,
        USER,
        COMPANY_A,
      );
      expect(res).toEqual({ id: 'ret-existing' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('IDOR: чужой заказ → NotFound, документ возврата не создаётся', async () => {
      orderRow = makeOrder({
        companyId: COMPANY_A,
        status: OrderStatus.DELIVERED,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 2, unitPrice: 100, unitCost: 0 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 200 }],
      });
      await expect(
        service.createReturn('order-1', oneItemDto as never, USER, COMPANY_B),
      ).rejects.toThrow(NotFoundException);
      expect(tx.return.create).not.toHaveBeenCalled();
    });

    it('возврат по отменённому заказу невозможен → BadRequest', async () => {
      orderRow = makeOrder({ status: OrderStatus.CANCELLED });
      await expect(
        service.createReturn('order-1', oneItemDto as never, USER, COMPANY_A),
      ).rejects.toThrow(/отмен/i);
    });

    it('P0-1: сумма возврата = нетто-цена строки, корректирует returnedTotal/paid/статус', async () => {
      // total 170 против валовых 200 → ratio 0.85; вернули 1×100 → 85
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 170,
        paid: 170,
        branchId: null,
        clientId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 2, unitPrice: 100, unitCost: 50 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 170 }],
      });
      await service.createReturn('order-1', oneItemDto as never, USER, COMPANY_A);

      expect(tx.return.create.mock.calls[0][0].data.amount).toBe(85);
      const upd = tx.order.updateMany.mock.calls[0][0].data;
      expect(upd.returnedTotal).toBe(85);
      expect(upd.paid).toBe(85); // 170 − 85 возвращено
      expect(upd.paymentStatus).toBe(PaymentStatus.PAID); // 170−85−85 = 0
    });

    it('P0-2: наличными выдаём только наличную часть оплаты', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 100,
        branchId: null,
        clientId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 0 },
        ],
        payments: [
          { method: PaymentMethod.CASH, amount: 60 },
          { method: PaymentMethod.CARD, amount: 40 },
        ],
      });
      await service.createReturn('order-1', oneItemDto as never, USER, COMPANY_A);

      expect(tx.cashMovement.create.mock.calls[0][0].data.amount).toBe(60);
      const doc = tx.return.create.mock.calls[0][0].data;
      expect(doc.cashRefunded).toBe(60);
      expect(doc.amount).toBe(100);
    });

    it('нельзя вернуть больше проданного: всё уже возвращено → «Нечего возвращать»', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 100,
        branchId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 2, unitPrice: 50, unitCost: 0 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 100 }],
      });
      tx.return.findMany.mockResolvedValue([
        { items: [{ orderItemId: 'oi-1', quantity: 2 }] }, // все 2 уже вернули
      ]);
      await expect(
        service.createReturn('order-1', oneItemDto as never, USER, COMPANY_A),
      ).rejects.toThrow(/нечего возвращать/i);
      expect(tx.return.create).not.toHaveBeenCalled();
    });

    it('продажа «в долг»: возврат уменьшает долг, а не выдаёт наличные', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 0, // денег не вносили
        paymentStatus: PaymentStatus.DEBT,
        branchId: null,
        clientId: 'client-1',
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 60 },
        ],
        payments: [{ method: PaymentMethod.DEBT, amount: 100 }],
      });
      await service.createReturn('order-1', oneItemDto as never, USER, COMPANY_A);

      // из кассы ничего не выдаём — денег не было
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
      const doc = tx.return.create.mock.calls[0][0].data;
      expect(doc.amount).toBe(100);
      expect(doc.cashRefunded).toBe(0);
      const upd = tx.order.updateMany.mock.calls[0][0].data;
      expect(upd.returnedTotal).toBe(100); // долг гасится стоимостью товара
      expect(upd.paid).toBe(0);
    });

    it('заказ меняется во время возврата (guard count=0) → BadRequest', async () => {
      orderRow = makeOrder({
        status: OrderStatus.DELIVERED,
        total: 100,
        paid: 100,
        branchId: null,
        items: [
          { id: 'oi-1', itemType: ItemType.SERVICE, productId: null, serviceId: null, description: 'x', quantity: 1, unitPrice: 100, unitCost: 0 },
        ],
        payments: [{ method: PaymentMethod.CASH, amount: 100 }],
      });
      tx.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.createReturn('order-1', oneItemDto as never, USER, COMPANY_A),
      ).rejects.toThrow(/order changed during return/i);
    });
  });

  // ─────────────────────────── updateStatus (статусы/tenant) ───────────────────────────
  describe('updateStatus — запрет отмены сменой статуса, tenant, переходы', () => {
    it('нельзя отменить заказ простой сменой статуса на CANCELLED → BadRequest (только через refund)', async () => {
      orderRow = makeOrder({ status: OrderStatus.ACCEPTED });
      await expect(
        service.updateStatus(
          'order-1',
          OrderStatus.CANCELLED,
          USER,
          'причина',
          COMPANY_A,
        ),
      ).rejects.toThrow(/возврат/i);
      // отмена не должна пройти как обычный переход — иначе долг/склад/деньги «повиснут»
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('IDOR: чужой заказ → NotFound, статус не меняется', async () => {
      orderRow = makeOrder({ status: OrderStatus.ACCEPTED, companyId: COMPANY_A });
      await expect(
        service.updateStatus(
          'order-1',
          OrderStatus.READY,
          USER,
          undefined,
          COMPANY_B,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('тот же статус → no-op без транзакции', async () => {
      orderRow = makeOrder({ status: OrderStatus.IN_PROGRESS });
      await service.updateStatus(
        'order-1',
        OrderStatus.IN_PROGRESS,
        USER,
        undefined,
        COMPANY_A,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('обычный переход: меняет статус и пишет историю (без уведомлений)', async () => {
      orderRow = makeOrder({ status: OrderStatus.ACCEPTED, clientId: null });
      await service.updateStatus(
        'order-1',
        OrderStatus.IN_PROGRESS,
        USER,
        'старт',
        COMPANY_A,
      );
      expect(tx.order.update.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: { status: OrderStatus.IN_PROGRESS },
        }),
      );
      expect(tx.orderStatusHistory.create.mock.calls[0][0].data.status).toBe(
        OrderStatus.IN_PROGRESS,
      );
      expect(deps.telegram.send).not.toHaveBeenCalled();
    });

    it('переход в READY уведомляет через Telegram', async () => {
      orderRow = makeOrder({ status: OrderStatus.IN_PROGRESS, clientId: null });
      await service.updateStatus(
        'order-1',
        OrderStatus.READY,
        USER,
        undefined,
        COMPANY_A,
      );
      expect(deps.telegram.send).toHaveBeenCalledTimes(1);
      expect(deps.telegram.send.mock.calls[0][0]).toBe(COMPANY_A);
    });
  });

  // ─────────── Гарантии, честно проверяемые только на ЖИВОЙ БД (it.todo) ───────────
  // На моках мы доказали, что сервис ВЫДАЁТ верные запросы и реагирует на их
  // результат; настоящую атомарность/блокировки/unique обеспечивает Postgres.
  it.todo(
    'ЖИВАЯ БД: реальный откат quickSale при сбое оплаты — usedCount промокода и bonusPoints клиента возвращаются к исходным (rollback транзакции)',
  );
  it.todo(
    'ЖИВАЯ БД: две конкурентные addPayment (двойной клик) не создают переплату — вторая падает на optimistic-guard paid',
  );
  it.todo(
    'ЖИВАЯ БД: гонка одинакового idempotencyKey у createReturn/quickSale — вторая транзакция падает на unique-индексе (P2002) и откатывается',
  );
  it.todo(
    'ЖИВАЯ БД: серия «частичный возврат + полный refund» не выдаёт наличными больше полученного кэша под конкуренцией (cashRefunded-агрегат под блокировкой)',
  );
});
