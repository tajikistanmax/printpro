import { randomUUID } from 'node:crypto';
import { ItemType, OrderType, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OrdersService } from '../../src/orders/orders.service';
import { AuditService } from '../../src/audit/audit.service';
import { makePrisma, truncateAll } from './_db';

/**
 * Интеграционные тесты OrdersService на ЖИВОМ Postgres.
 *
 * Здесь честно проверяются гарантии УРОВНЯ БД, которые unit-тесты с моками
 * (orders.service.spec.ts) проверить не могут и вынесли в it.todo:
 *   1) реальный ОТКАТ транзакции quickSale при сбое шага внутри неё —
 *      usedCount промокода и bonusPoints клиента возвращаются к исходным;
 *   2) две конкурентные addPayment («двойной клик») не создают переплату —
 *      optimistic-guard по paid пропускает ровно одну;
 *   3) дубль idempotencyKey → unique-индекс (P2002), в БД ровно один документ.
 *
 * Сервис инстанцируется с НАСТОЯЩИМ PrismaService и НАСТОЯЩИМ AuditService
 * (его recordTx пишет в ту же транзакцию — если он бросит, всё откатится).
 * Внешние I/O (Telegram/Email/Promocodes) — заглушки: они не участвуют в
 * денежных инвариантах уровня БД.
 */
describe('Интеграция (живой Postgres): OrdersService — гарантии уровня БД', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  let telegram: { send: jest.Mock };
  let email: { send: jest.Mock };
  let service: OrdersService;

  beforeAll(async () => {
    prisma = makePrisma();
    await prisma.$connect();
    audit = new AuditService(prisma);
    telegram = { send: jest.fn().mockResolvedValue(true) };
    email = { send: jest.fn().mockResolvedValue(undefined) };
    service = new OrdersService(
      prisma,
      telegram as never,
      {} as never, // promocodes: сервис консумит промо через tx.promoCode, отдельный сервис не нужен
      email as never,
      audit,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Снимаем spy (audit.recordTx) между тестами; jest.fn-заглушки не трогает.
    jest.restoreAllMocks();
  });

  // ───────────────────────────── seed-хелперы ─────────────────────────────
  // Минимальный набор реальных строк для сценариев (required-поля из schema.prisma).
  async function seedCompany(name = 'ACME'): Promise<string> {
    const c = await prisma.company.create({ data: { name } });
    return c.id;
  }
  async function seedUser(companyId: string, login = 'cashier'): Promise<string> {
    const u = await prisma.user.create({
      data: { companyId, login, passwordHash: 'x', fullName: 'Кассир' },
    });
    return u.id;
  }
  async function seedOpenShift(companyId: string, userId: string): Promise<string> {
    const s = await prisma.cashShift.create({
      data: { companyId, userId, openingBalance: 0 },
    });
    return s.id;
  }
  async function seedClient(
    companyId: string,
    phone: string,
    bonusPoints = 0,
  ): Promise<string> {
    const cl = await prisma.client.create({
      data: { companyId, phone, bonusPoints },
    });
    return cl.id;
  }
  async function seedPromo(
    companyId: string,
    code: string,
    value = 10,
  ): Promise<string> {
    const p = await prisma.promoCode.create({
      data: { companyId, code, value }, // discountType=PERCENT, usedCount=0, isActive=true — по умолчанию
    });
    return p.id;
  }
  async function seedOrder(
    companyId: string,
    orderNumber: string,
    total: number,
  ): Promise<string> {
    const o = await prisma.order.create({
      data: {
        companyId,
        orderNumber,
        orderType: OrderType.SALE,
        total,
        paid: 0,
        balanceDue: total,
      },
    });
    return o.id;
  }

  const serviceItem = (unitPrice: number) => [
    {
      itemType: ItemType.SERVICE,
      description: 'Печать',
      quantity: 1,
      unitPrice,
    },
  ];

  // ─────────────────── (1) ОТКАТ quickSale при сбое шага ───────────────────
  it('ОТКАТ quickSale: сбой оплаты (нет открытой смены) возвращает usedCount промокода и bonusPoints клиента к исходным', async () => {
    const companyId = await seedCompany();
    const userId = await seedUser(companyId);
    // Открытой смены НЕ создаём → шаг оплаты внутри транзакции бросит и всё откатит.
    const phone = '+992900000001';
    await seedClient(companyId, phone, 1000);
    await seedPromo(companyId, 'SALE10', 10);

    await expect(
      service.quickSale(
        {
          companyId,
          clientPhone: phone,
          method: PaymentMethod.CASH,
          discount: 20, // ручная скидка → остаток 80
          promoCode: 'SALE10', // −10% → остаток 72, usedCount++ (в tx)
          useBonus: 30, // спишет 21.6 бонуса (в tx), остаток 50.4
          items: serviceItem(100),
        } as never,
        userId,
      ),
    ).rejects.toThrow(/cash shift/i);

    // Инвариант В БД: транзакция откатилась ЦЕЛИКОМ.
    const promo = await prisma.promoCode.findFirst({
      where: { companyId, code: 'SALE10' },
    });
    expect(promo!.usedCount).toBe(0); // не 1 — инкремент откатился

    const client = await prisma.client.findFirst({ where: { companyId, phone } });
    expect(Number(client!.bonusPoints)).toBe(1000); // не 978.4 — списание откатилось

    // Ни заказа, ни платежа, ни движений — ничего не «протекло» из отменённой транзакции.
    expect(await prisma.order.count({ where: { companyId } })).toBe(0);
    expect(await prisma.payment.count({ where: { companyId } })).toBe(0);
  });

  it('ОТКАТ quickSale: бросок аудита ВНУТРИ транзакции (recordTx) тоже откатывает промокод/бонусы/заказ/платёж', async () => {
    const companyId = await seedCompany();
    const userId = await seedUser(companyId);
    await seedOpenShift(companyId, userId); // смена ЕСТЬ — оплата сама по себе прошла бы
    const phone = '+992900000002';
    await seedClient(companyId, phone, 1000);
    await seedPromo(companyId, 'SALE10', 10);

    // Заставляем реальный AuditService.recordTx упасть — он пишет в ТУ ЖЕ транзакцию,
    // поэтому его сбой обязан откатить все мутации (гарантия «нет денег без следа»).
    const spy = jest
      .spyOn(audit, 'recordTx')
      .mockRejectedValue(new Error('audit down'));
    try {
      await expect(
        service.quickSale(
          {
            companyId,
            clientPhone: phone,
            method: PaymentMethod.CASH,
            discount: 20,
            promoCode: 'SALE10',
            useBonus: 30,
            items: serviceItem(100),
          } as never,
          userId,
        ),
      ).rejects.toThrow(/audit down/i);
    } finally {
      spy.mockRestore();
    }

    // Всё откатилось, несмотря на то что оплата/бонусы/промо УСПЕЛИ выполниться в tx.
    expect(
      (await prisma.promoCode.findFirst({ where: { companyId, code: 'SALE10' } }))!
        .usedCount,
    ).toBe(0);
    expect(
      Number(
        (await prisma.client.findFirst({ where: { companyId, phone } }))!
          .bonusPoints,
      ),
    ).toBe(1000);
    expect(await prisma.order.count({ where: { companyId } })).toBe(0);
    expect(await prisma.payment.count({ where: { companyId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { companyId } })).toBe(0);
  });

  // ───────────── (2) Конкурентные addPayment не создают переплату ─────────────
  it('две конкурентные addPayment (двойной клик на полную сумму) не создают переплату: paid ≤ total, ровно один платёж', async () => {
    const companyId = await seedCompany();
    const userId = await seedUser(companyId);
    await seedOpenShift(companyId, userId);
    const orderId = await seedOrder(companyId, 'ORD-RACE-1', 100);

    // Тот же платёж на всю сумму «нажат» дважды одновременно.
    const pay = () =>
      service.addPayment(
        orderId,
        { amount: 100, method: PaymentMethod.CASH },
        userId,
        companyId,
      );
    const results = await Promise.allSettled([pay(), pay()]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Ровно одна оплата проходит; вторая отбита (optimistic-guard по paid ЛИБО
    // «заказ уже оплачен» — в зависимости от планирования, обе — отказ).
    expect(ok).toBe(1);
    expect(failed).toBe(1);

    // Инвариант В БД: переплаты нет.
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(Number(order!.paid)).toBe(100); // не 200
    expect(Number(order!.paid)).toBeLessThanOrEqual(Number(order!.total));

    // И ровно один денежный документ (второй платёж не создан).
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
  });

  // ───────────── (3) Дубль idempotencyKey → P2002, один документ ─────────────
  it('дубль idempotencyKey у quickSale под гонкой: в БД ровно один заказ, оба вызова получают именно его', async () => {
    const companyId = await seedCompany();
    const userId = await seedUser(companyId);
    const key = randomUUID();

    // total=0 (бесплатная позиция) — успешная продажа не требует открытой смены,
    // так что первая транзакция гарантированно коммитится, а вторая натыкается на
    // unique idempotencyKey и через catch(P2002) возвращает уже созданный заказ.
    const dto = () =>
      ({
        companyId,
        idempotencyKey: key,
        method: PaymentMethod.CASH,
        items: serviceItem(0),
      }) as never;

    const results = await Promise.allSettled([
      service.quickSale(dto(), userId),
      service.quickSale(dto(), userId),
    ]);

    // Обе завершились без ошибки: вторая перехватила P2002 и вернула существующий заказ.
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled',
    );
    expect(fulfilled.length).toBe(2);

    // Инвариант В БД: заказ с этим ключом — ровно один (и всего один заказ в компании).
    const byKey = await prisma.order.findMany({
      where: { companyId, idempotencyKey: key },
    });
    expect(byKey.length).toBe(1);
    expect(await prisma.order.count({ where: { companyId } })).toBe(1);

    // Оба вызова вернули один и тот же (единственный) заказ.
    expect(fulfilled[0].value?.id).toBe(byKey[0].id);
    expect(fulfilled[1].value?.id).toBe(byKey[0].id);
  });

  it('unique-индекс Order.idempotencyKey реально отклоняет дубль ключа (P2002) — детерминированно', async () => {
    const companyId = await seedCompany();
    const key = randomUUID();
    await prisma.order.create({
      data: {
        companyId,
        orderNumber: 'ORD-A',
        orderType: OrderType.SALE,
        idempotencyKey: key,
      },
    });

    // Вторая вставка с тем же ключом (другой orderNumber) должна упасть на unique-индексе.
    let code: string | undefined;
    try {
      await prisma.order.create({
        data: {
          companyId,
          orderNumber: 'ORD-B',
          orderType: OrderType.SALE,
          idempotencyKey: key,
        },
      });
    } catch (e: any) {
      code = e?.code;
    }
    expect(code).toBe('P2002'); // нарушение уникальности idempotencyKey

    // В БД — ровно один документ с этим ключом.
    expect(
      await prisma.order.count({ where: { companyId, idempotencyKey: key } }),
    ).toBe(1);
  });
});
