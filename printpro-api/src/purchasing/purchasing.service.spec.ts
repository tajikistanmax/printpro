import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReceiptPaymentStatus, StockMovementType } from '@prisma/client';
import { PurchasingService } from './purchasing.service';

/**
 * Юнит-тесты бизнес-правил закупок. Сервис поднимаем НАПРЯМУЮ с моками Prisma и
 * AuditService: вся арифметика (сумма приёмки, зажим оплаты, долг, статус оплаты,
 * распределение оплаты по приёмкам FIFO, округления) выполняется по-настоящему —
 * подменяется только персистентность (запись в БД).
 *
 * Фокус (по ТЗ):
 *  - приёмка товара (createReceipt);
 *  - «оплата из кассы» vs «в долг»: при paidFromCash=false движения по кассе НЕТ
 *    (и открытая смена не требуется);
 *  - погашение долга поставщику (paySupplierDebt) гасит СТАРЫЕ приёмки первыми.
 */

const COMPANY = 'company-1';
const SUPPLIER_ID = 'sup-1';
const SUPPLIER_NAME = 'ООО Ромашка';
const BRANCH = 'branch-1';
const PRODUCT = 'prod-1';
const USER = 'user-1';

interface HarnessCfg {
  // Свежий долг поставщика, который читается ВНУТРИ транзакции paySupplierDebt.
  debt?: number;
  // Открытые приёмки поставщика (уже отсортированы по дате asc, как вернула бы БД).
  openReceipts?: Array<Record<string, unknown>>;
  // Остаток товара на складе до приёмки (null = позиции ещё не было).
  prevStock?: { quantity: number } | null;
}

// Собирает сервис с моками. Дефолты = happy-path; каждый тест точечно
// переопределяет нужный мок (напр. h.prisma.branch.findFirst -> null).
function createHarness(cfg: HarnessCfg = {}) {
  const tx = {
    // nextSeq() дергает $queryRaw — возвращаем следующий номер счётчика.
    $queryRaw: jest.fn(async () => [{ value: 7 }]),
    stockReceipt: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'receipt-1',
        number: data.number,
        supplier: data.supplierId ? { id: data.supplierId, name: SUPPLIER_NAME } : null,
        ...data,
      })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, __loaded: true })),
      findMany: jest.fn(async () => cfg.openReceipts ?? []),
    },
    stock: {
      findUnique: jest.fn(async () => cfg.prevStock ?? null),
      upsert: jest.fn(async () => ({})),
    },
    product: { update: jest.fn(async () => ({})) },
    stockMovement: { create: jest.fn(async () => ({})) },
    supplier: {
      // select:{debt:true} -> свежий долг; иначе полная карточка поставщика.
      findUnique: jest.fn(async ({ where, select }: any) =>
        select && select.debt
          ? { debt: cfg.debt ?? 0 }
          : { id: where.id, companyId: COMPANY, name: SUPPLIER_NAME },
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    supplierPayment: { create: jest.fn(async () => ({})) },
    cashShift: { findFirst: jest.fn(async () => ({ id: 'shift-1' })) },
    cashMovement: { create: jest.fn(async () => ({})) },
  };

  const prisma = {
    // Транзакция просто прогоняет колбэк с нашим tx-моком.
    $transaction: jest.fn((cb: any) => cb(tx)),
    supplier: {
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        companyId: COMPANY,
        name: SUPPLIER_NAME,
      })),
    },
    branch: { findFirst: jest.fn(async () => ({ id: BRANCH })) },
    // По умолчанию все запрошенные товары «наши».
    product: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.id.in as string[]).map((id) => ({ id })),
      ),
    },
  };

  const audit = { recordTx: jest.fn(async () => {}), record: jest.fn(async () => {}) };

  const service = new PurchasingService(prisma as any, audit as any);
  return { service, prisma, tx, audit };
}

// Стандартная позиция приёмки: qty*cost = total.
function item(overrides: Record<string, unknown> = {}) {
  return { productId: PRODUCT, quantity: 2, cost: 50, ...overrides };
}

describe('PurchasingService.createReceipt — приёмка товара', () => {
  describe('оплата из кассы vs в долг (paidFromCash)', () => {
    it('paidFromCash по умолчанию (true), оплачено полностью → расход из кассы на сумму оплаты', async () => {
      const h = createHarness();
      await h.service.createReceipt(
        { companyId: COMPANY, branchId: BRANCH, items: [item()] } as any,
        USER,
      );

      // total = 2*50 = 100, оплачено полностью -> из кассы уходит 100.
      expect(h.tx.cashShift.findFirst).toHaveBeenCalledTimes(1); // нужна открытая смена
      expect(h.tx.cashMovement.create).toHaveBeenCalledTimes(1);
      expect(h.tx.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY,
            shiftId: 'shift-1',
            type: 'OUT',
            amount: 100,
            category: 'Поставщики',
          }),
        }),
      );
      // Долга нет, поставщика нет — карточку долга не трогаем.
      expect(h.tx.supplier.update).not.toHaveBeenCalled();
    });

    it('paidFromCash=false, оплачено полностью → движения по кассе НЕТ и открытая смена НЕ требуется', async () => {
      const h = createHarness();
      // Даже если открытой смены нет — при оплате не из кассы это неважно.
      h.tx.cashShift.findFirst.mockResolvedValue(null as any);

      const res = await h.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          paidFromCash: false,
          items: [item()],
        } as any,
        USER,
      );

      // Ключевое правило: касса не уменьшается, смену не ищем.
      expect(h.tx.cashMovement.create).not.toHaveBeenCalled();
      expect(h.tx.cashShift.findFirst).not.toHaveBeenCalled();
      // Приёмка всё равно проведена (вернулась загруженная запись).
      expect(res).toBeDefined();
      expect(h.tx.stockReceipt.create).toHaveBeenCalledTimes(1);
    });

    it('paidFromCash=false, оплачено частично → долг поставщику растёт, но касса не трогается', async () => {
      const h = createHarness();
      await h.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          supplierId: SUPPLIER_ID,
          paidFromCash: false,
          paidAmount: 40, // total 100 -> долг 60
          dueDate: '2026-09-01',
          items: [item()],
        } as any,
        USER,
      );

      expect(h.tx.cashMovement.create).not.toHaveBeenCalled();
      expect(h.tx.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SUPPLIER_ID },
          data: { debt: { increment: 60 } },
        }),
      );
      // Статус PARTIAL и зафиксированный срок оплаты.
      expect(h.tx.stockReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paidAmount: 40,
            paymentStatus: ReceiptPaymentStatus.PARTIAL,
            paidFromCash: false,
            dueDate: new Date('2026-09-01'),
          }),
        }),
      );
    });

    it('paidFromCash=true, но оплачено 0 (в долг) → расхода по кассе нет (нечего списывать)', async () => {
      const h = createHarness();
      await h.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          supplierId: SUPPLIER_ID,
          paidAmount: 0, // весь total уходит в долг
          items: [item()],
        } as any,
        USER,
      );

      expect(h.tx.cashMovement.create).not.toHaveBeenCalled();
      expect(h.tx.cashShift.findFirst).not.toHaveBeenCalled();
      expect(h.tx.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { debt: { increment: 100 } } }),
      );
      expect(h.tx.stockReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentStatus: ReceiptPaymentStatus.DEBT }),
        }),
      );
    });
  });

  describe('суммы, статусы оплаты и валидация', () => {
    it('total = сумма cost*quantity по позициям (округление до 2 знаков)', async () => {
      const h = createHarness();
      await h.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          items: [
            item({ quantity: 3, cost: 10.1 }), // 30.3
            item({ productId: 'prod-2', quantity: 2, cost: 4.05 }), // 8.1
          ],
        } as any,
        USER,
      );
      // Оба товара «наши» (дефолтный findMany мапит все запрошенные id).
      expect(h.tx.stockReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ total: 38.4 }) }),
      );
    });

    it('paymentStatus: PAID / PARTIAL / DEBT в зависимости от оплаты', async () => {
      // PAID: paidAmount не задан -> считается полностью оплаченным.
      const paid = createHarness();
      await paid.service.createReceipt(
        { companyId: COMPANY, branchId: BRANCH, items: [item()] } as any,
        USER,
      );
      expect(paid.tx.stockReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentStatus: ReceiptPaymentStatus.PAID }),
        }),
      );

      // PARTIAL: 0 < оплата < total.
      const partial = createHarness();
      await partial.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          supplierId: SUPPLIER_ID,
          paidAmount: 30,
          items: [item()],
        } as any,
        USER,
      );
      expect(partial.tx.stockReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentStatus: ReceiptPaymentStatus.PARTIAL }),
        }),
      );

      // DEBT: оплата = 0.
      const debt = createHarness();
      await debt.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          supplierId: SUPPLIER_ID,
          paidAmount: 0,
          items: [item()],
        } as any,
        USER,
      );
      expect(debt.tx.stockReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentStatus: ReceiptPaymentStatus.DEBT }),
        }),
      );
    });

    it('оплата зажимается суммой приёмки — из кассы не уходит лишнее', async () => {
      const h = createHarness();
      await h.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          paidAmount: 999, // total всего 100
          items: [item()],
        } as any,
        USER,
      );
      // paidAmount зажат до total, статус PAID, из кассы ровно 100 (не 999).
      expect(h.tx.stockReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paidAmount: 100,
            paymentStatus: ReceiptPaymentStatus.PAID,
          }),
        }),
      );
      expect(h.tx.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 100 }) }),
      );
    });

    it('приёмка в долг без поставщика → BadRequest, транзакция не стартует', async () => {
      const h = createHarness();
      await expect(
        h.service.createReceipt(
          {
            companyId: COMPANY,
            branchId: BRANCH,
            paidAmount: 40, // долг 60, но supplierId нет
            items: [item()],
          } as any,
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('пустой список позиций → BadRequest', async () => {
      const h = createHarness();
      await expect(
        h.service.createReceipt(
          { companyId: COMPANY, branchId: BRANCH, items: [] } as any,
          USER,
        ),
      ).rejects.toThrow('Добавьте хотя бы одну позицию');
    });

    it('филиал не найден (или чужой) → BadRequest', async () => {
      const h = createHarness();
      h.prisma.branch.findFirst.mockResolvedValue(null as any);
      await expect(
        h.service.createReceipt(
          { companyId: COMPANY, branchId: 'foreign', items: [item()] } as any,
          USER,
        ),
      ).rejects.toThrow('Филиал не найден');
    });

    it('товар из чужой компании в позиции → BadRequest (tenant-проверка)', async () => {
      const h = createHarness();
      h.prisma.product.findMany.mockResolvedValue([] as any); // ни один товар не «наш»
      await expect(
        h.service.createReceipt(
          { companyId: COMPANY, branchId: BRANCH, items: [item()] } as any,
          USER,
        ),
      ).rejects.toThrow('Один или несколько товаров не найдены');
    });

    it('поставщик из чужой компании → NotFound (tenant-проверка)', async () => {
      const h = createHarness();
      h.prisma.supplier.findUnique.mockResolvedValue({
        id: SUPPLIER_ID,
        companyId: 'other-company',
        name: SUPPLIER_NAME,
      } as any);
      await expect(
        h.service.createReceipt(
          {
            companyId: COMPANY,
            branchId: BRANCH,
            supplierId: SUPPLIER_ID,
            items: [item()],
          } as any,
          USER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('движение склада фиксирует остаток до/после и обновляет цены товара', async () => {
      const h = createHarness({ prevStock: { quantity: 5 } });
      await h.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          items: [item({ quantity: 3, cost: 50, salePrice: 120 })],
        } as any,
        USER,
      );

      // Остаток 5 -> +3 -> 8; движение типа IN.
      expect(h.tx.stock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: { increment: 3 } } }),
      );
      expect(h.tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: StockMovementType.IN,
            quantity: 3,
            beforeQty: 5,
            afterQty: 8,
          }),
        }),
      );
      // Закупочная и продажная цены товара обновились по приёмке.
      expect(h.tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PRODUCT },
          data: { purchasePrice: 50, salePrice: 120 },
        }),
      );
    });

    it('нулевая цена не трогает карточку товара', async () => {
      const h = createHarness();
      await h.service.createReceipt(
        {
          companyId: COMPANY,
          branchId: BRANCH,
          items: [item({ quantity: 2, cost: 0 })],
        } as any,
        USER,
      );
      expect(h.tx.product.update).not.toHaveBeenCalled();
    });

    it('оплата из кассы без открытой смены → BadRequest «Open cash shift not found»', async () => {
      const h = createHarness();
      h.tx.cashShift.findFirst.mockResolvedValue(null as any);
      await expect(
        h.service.createReceipt(
          { companyId: COMPANY, branchId: BRANCH, items: [item()] } as any,
          USER,
        ),
      ).rejects.toThrow('Open cash shift not found');
    });

    it('пишет аудит и складской, и денежной стороны приёмки', async () => {
      const h = createHarness();
      await h.service.createReceipt(
        { companyId: COMPANY, branchId: BRANCH, items: [item()] } as any,
        USER,
      );
      const actions = h.audit.recordTx.mock.calls.map((c: any) => c[1].action);
      expect(actions).toContain('stock:receipt');
      expect(actions).toContain('money:receipt');
    });
  });
});

describe('PurchasingService.paySupplierDebt — погашение долга (старые приёмки первыми)', () => {
  it('гасит СТАРЫЕ приёмки первыми (FIFO): полностью закрывает первую, частично вторую', async () => {
    const receiptA = {
      id: 'A',
      date: new Date('2026-01-01'),
      total: 100,
      paidAmount: 0,
      dueDate: new Date('2026-02-01'),
    };
    const receiptB = {
      id: 'B',
      date: new Date('2026-03-01'),
      total: 50,
      paidAmount: 0,
      dueDate: new Date('2026-04-01'),
    };
    const h = createHarness({ debt: 150, openReceipts: [receiptA, receiptB] });

    await h.service.paySupplierDebt(SUPPLIER_ID, { amount: 120 } as any, USER, COMPANY);

    // Открытые приёмки берутся в порядке даты по возрастанию (старые первыми).
    expect(h.tx.stockReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY,
          supplierId: SUPPLIER_ID,
          deletedAt: null,
          paymentStatus: {
            in: [ReceiptPaymentStatus.DEBT, ReceiptPaymentStatus.PARTIAL],
          },
        }),
        orderBy: { date: 'asc' },
      }),
    );

    // Ровно два обновления, и первое — по СТАРОЙ приёмке A.
    expect(h.tx.stockReceipt.update).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = h.tx.stockReceipt.update.mock.calls;
    // A: 100 из 100 -> PAID, срок оплаты снимается.
    expect(firstCall[0]).toEqual(
      expect.objectContaining({
        where: { id: 'A' },
        data: expect.objectContaining({
          paidAmount: 100,
          paymentStatus: ReceiptPaymentStatus.PAID,
          dueDate: null,
        }),
      }),
    );
    // B: остаток 20 из 50 -> PARTIAL, срок оплаты сохраняется.
    expect(secondCall[0]).toEqual(
      expect.objectContaining({
        where: { id: 'B' },
        data: expect.objectContaining({
          paidAmount: 20,
          paymentStatus: ReceiptPaymentStatus.PARTIAL,
          dueDate: receiptB.dueDate,
        }),
      }),
    );

    // Долг атомарно уменьшен, из кассы ушла оплата.
    expect(h.tx.supplier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SUPPLIER_ID, debt: { gte: 120 } },
        data: { debt: { decrement: 120 } },
      }),
    );
    expect(h.tx.cashMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'OUT',
          amount: 120,
          category: 'Поставщики',
        }),
      }),
    );
  });

  it('распределение прекращается, когда оплата исчерпана (вторая приёмка не тронута)', async () => {
    const receiptA = { id: 'A', date: new Date('2026-01-01'), total: 100, paidAmount: 0, dueDate: null };
    const receiptB = { id: 'B', date: new Date('2026-02-01'), total: 100, paidAmount: 0, dueDate: null };
    const h = createHarness({ debt: 200, openReceipts: [receiptA, receiptB] });

    await h.service.paySupplierDebt(SUPPLIER_ID, { amount: 30 } as any, USER, COMPANY);

    expect(h.tx.stockReceipt.update).toHaveBeenCalledTimes(1);
    expect(h.tx.stockReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'A' },
        data: expect.objectContaining({
          paidAmount: 30,
          paymentStatus: ReceiptPaymentStatus.PARTIAL,
        }),
      }),
    );
  });

  it('оплата зажимается остатком долга (нельзя списать больше, чем должны)', async () => {
    const receiptA = { id: 'A', date: new Date('2026-01-01'), total: 100, paidAmount: 0, dueDate: null };
    const h = createHarness({ debt: 100, openReceipts: [receiptA] });

    await h.service.paySupplierDebt(SUPPLIER_ID, { amount: 500 } as any, USER, COMPANY);

    // pay = min(500, долг 100) = 100.
    expect(h.tx.supplier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { debt: { decrement: 100 } } }),
    );
    expect(h.tx.cashMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 100 }) }),
    );
  });

  it('у поставщика нет долга → BadRequest, ни списания, ни расхода кассы', async () => {
    const h = createHarness({ debt: 0 });
    await expect(
      h.service.paySupplierDebt(SUPPLIER_ID, { amount: 50 } as any, USER, COMPANY),
    ).rejects.toThrow('У поставщика нет долга к оплате');
    expect(h.tx.supplier.updateMany).not.toHaveBeenCalled();
    expect(h.tx.cashMovement.create).not.toHaveBeenCalled();
  });

  it('гонка: долг изменился (updateMany.count=0) → BadRequest, деньги не уходят', async () => {
    const h = createHarness({ debt: 100 });
    h.tx.supplier.updateMany.mockResolvedValue({ count: 0 } as any);
    await expect(
      h.service.paySupplierDebt(SUPPLIER_ID, { amount: 50 } as any, USER, COMPANY),
    ).rejects.toThrow('Долг изменился');
    // До записи оплаты и расхода кассы дело не дошло.
    expect(h.tx.supplierPayment.create).not.toHaveBeenCalled();
    expect(h.tx.cashMovement.create).not.toHaveBeenCalled();
  });

  it('поставщик не найден → NotFound, транзакция не стартует', async () => {
    const h = createHarness({ debt: 100 });
    h.prisma.supplier.findUnique.mockResolvedValue(null as any);
    await expect(
      h.service.paySupplierDebt(SUPPLIER_ID, { amount: 50 } as any, USER, COMPANY),
    ).rejects.toThrow(NotFoundException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('оплата долга из кассы без открытой смены → BadRequest', async () => {
    const h = createHarness({ debt: 100, openReceipts: [] });
    h.tx.cashShift.findFirst.mockResolvedValue(null as any);
    await expect(
      h.service.paySupplierDebt(SUPPLIER_ID, { amount: 50 } as any, USER, COMPANY),
    ).rejects.toThrow('Open cash shift not found');
  });

  it('фиксирует платёж поставщику (сумма, поставщик, компания, пользователь)', async () => {
    const h = createHarness({ debt: 100, openReceipts: [] });
    await h.service.paySupplierDebt(
      SUPPLIER_ID,
      { amount: 40, note: 'аванс' } as any,
      USER,
      COMPANY,
    );
    expect(h.tx.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY,
          supplierId: SUPPLIER_ID,
          amount: 40,
          note: 'аванс',
          userId: USER,
        }),
      }),
    );
  });
});

/**
 * Правила, чью КОРРЕКТНОСТЬ гарантирует сама БД/транзакция, а не логика на JS.
 * На моках их проверить честно нельзя — оформлены как todo (не флейки, не красные).
 */
describe('сценарии, требующие живой БД (Prisma-транзакция)', () => {
  it.todo(
    'параллельные paySupplierDebt не списывают деньги дважды — атомарность updateMany(debt>=pay) проверяется только на реальной БД',
  );
  it.todo(
    'при падении записи аудита внутри createReceipt вся приёмка откатывается (реальный $transaction rollback) — нужна живая БД',
  );
  it.todo(
    'сквозная FIFO-сортировка приёмок по дате выполняется самой БД (orderBy date asc) — на моках проверяем передачу orderBy и порядок обработки массива',
  );
});
