import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  ProductionStatus,
  StockMovementType,
} from '@prisma/client';
import { ProductionService } from './production.service';

/**
 * Юнит-тесты ProductionService.updateStatus — самое «денежное» место модуля.
 *
 * Проверяем РЕАЛЬНЫЕ бизнес-правила завершения производственного задания:
 *  - списание материалов и перевод задания в COMPLETED идут в ОДНОЙ транзакции
 *    ($transaction с колбэком): нехватка остатка не даёт заданию стать COMPLETED
 *    без списания (P0-8);
 *  - при списании фиксируется СНИМОК себестоимости на движении склада
 *    (unitCost = Product.purchasePrice, totalCost = unitCost * qty, округление) — P1-2;
 *  - реверс списания при уходе из COMPLETED возвращает на склад НЕПОГАШЕННЫЙ
 *    объём и восстанавливает себестоимость (P1-97);
 *  - идемпотентность: повторное завершение уже списанного задания не списывает
 *    материалы второй раз;
 *  - syncOrderStatus НЕ откатывает терминальный/пост-продакшн статус заказа
 *    (DELIVERED/CANCELLED) обратно в производство (P0-9).
 *
 * PrismaService подменяется СТАТЕФУЛ-моком: один и тот же объект `db` служит и
 * корневым клиентом, и транзакционным `tx` (как в реальном Prisma у tx те же
 * делегаты). Остаток склада хранится в Map и реально уменьшается/увеличивается —
 * поэтому проверки «сколько списано / сколько вернулось» честные, а не по вызовам.
 */

type MaterialSpec = { productId: string; qtyPerUnit: number };
type ItemSpec = { quantity: number; materials: MaterialSpec[] };
type ProductSpec = { id: string; purchasePrice: number | null };
type StockSpec = { productId: string; branchId: string; quantity: number };
type MovementSpec = {
  productId: string;
  branchId: string | null;
  type: StockMovementType;
  quantity: number;
  unitCost?: number;
};

interface FixtureOpts {
  job?: Partial<{
    id: string;
    companyId: string;
    orderId: string;
    status: ProductionStatus;
    materialsWrittenOff: boolean;
    startedAt: Date | null;
    deletedAt: Date | null;
  }>;
  orderStatus?: OrderStatus;
  branchId?: string | null;
  items?: ItemSpec[];
  products?: ProductSpec[];
  stock?: StockSpec[];
  movements?: MovementSpec[];
  siblings?: { status: ProductionStatus }[] | null;
}

const round3 = (n: number) => Number(n.toFixed(3));
const skey = (productId: string, branchId: string | null) =>
  `${productId}__${branchId}`;

function setup(opts: FixtureOpts = {}) {
  const job = {
    id: 'job-1',
    companyId: 'co-1',
    orderId: 'ord-1',
    status: ProductionStatus.PENDING,
    materialsWrittenOff: false,
    startedAt: null as Date | null,
    deletedAt: null as Date | null,
    ...opts.job,
  };

  const branchId = opts.branchId === undefined ? 'br-1' : opts.branchId;

  const order = {
    id: job.orderId,
    companyId: job.companyId,
    orderNumber: 'A-100',
    branchId,
    status: opts.orderStatus ?? OrderStatus.READY,
    items: (opts.items ?? []).map((it) => ({
      quantity: it.quantity,
      service: { materials: it.materials.map((m) => ({ ...m })) },
    })),
  };

  const products: ProductSpec[] = opts.products ?? [];

  // Живой остаток склада.
  const stock = new Map<string, StockSpec>();
  for (const s of opts.stock ?? []) stock.set(skey(s.productId, s.branchId), { ...s });

  // Предсуществующие движения (для сценариев реверса). Мутируется create().
  const movements: any[] = (opts.movements ?? []).map((m) => ({
    productId: m.productId,
    branchId: m.branchId,
    type: m.type,
    quantity: m.quantity,
    unitCost: m.unitCost ?? 0,
    productionJobId: job.id,
    deletedAt: null,
  }));

  const db: any = {
    productionJob: {
      // ensure(): текущая строка задания (копия — как чтение из БД).
      findFirst: jest.fn(async ({ where }: any) => {
        if (
          where.id === job.id &&
          where.companyId === job.companyId &&
          job.deletedAt == null
        ) {
          return { ...job };
        }
        return null;
      }),
      // syncOrderStatus(): статусы заданий заказа (после мутации — свежий статус).
      findMany: jest.fn(async ({ where }: any) => {
        if (where.orderId === job.orderId) {
          return opts.siblings ?? [{ status: job.status }];
        }
        return [];
      }),
      // Атомарный claim флага materialsWrittenOff (write-off: false→true, reverse: true→false).
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (
          where.id === job.id &&
          where.materialsWrittenOff === job.materialsWrittenOff &&
          job.deletedAt == null
        ) {
          Object.assign(job, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(job, data);
        return { ...job };
      }),
    },
    order: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === order.id ? { ...order } : null,
      ),
      update: jest.fn(async () => ({})),
    },
    product: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.id.in;
        return products
          .filter((p) => ids.includes(p.id))
          .map((p) => ({ id: p.id, purchasePrice: p.purchasePrice }));
      }),
    },
    stock: {
      // Условное списание под «блокировкой»: decrement только если остаток >= qty.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const s = stock.get(skey(where.productId, where.branchId));
        const need = where.quantity.gte;
        if (!s || s.quantity < need) return { count: 0 };
        s.quantity = round3(s.quantity - data.quantity.decrement);
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const { productId, branchId } = where.productId_branchId;
        const s = stock.get(skey(productId, branchId));
        return s ? { quantity: s.quantity } : null;
      }),
      // Возврат на склад при реверсе (increment под «блокировкой»).
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const { productId, branchId } = where.productId_branchId;
        const k = skey(productId, branchId);
        let s = stock.get(k);
        if (!s) {
          s = { productId, branchId, quantity: create.quantity };
          stock.set(k, s);
        } else {
          s.quantity = round3(s.quantity + update.quantity.increment);
        }
        return { quantity: s.quantity };
      }),
    },
    stockMovement: {
      create: jest.fn(async ({ data }: any) => {
        movements.push(data);
        return { id: `mv-${movements.length}`, ...data };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        movements.filter(
          (m) => m.productionJobId === where.productionJobId && m.deletedAt == null,
        ),
      ),
    },
    orderStatusHistory: { create: jest.fn(async () => ({})) },
    // Колбэк-форма выполняет tx-логику на том же db; массив-форма — Promise.all.
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') return arg(db);
      if (Array.isArray(arg)) return Promise.all(arg);
      return undefined;
    }),
  };

  const audit = {
    record: jest.fn(async () => undefined),
    recordTx: jest.fn(async () => undefined),
  };

  const warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined as any);

  const service = new ProductionService(db as any, audit as any);

  const stockQty = (productId: string, bId: string | null = branchId) =>
    stock.get(skey(productId, bId))?.quantity;
  const writeOffFor = (productId: string) =>
    movements.find(
      (m) => m.productId === productId && m.type === StockMovementType.WRITE_OFF,
    );
  const inFor = (productId: string) =>
    movements.find(
      (m) => m.productId === productId && m.type === StockMovementType.IN,
    );

  return { service, db, audit, warnSpy, job, stockQty, writeOffFor, inFor, movements };
}

afterEach(() => jest.restoreAllMocks());

describe('ProductionService.updateStatus', () => {
  describe('guard', () => {
    it('несуществующее задание → NotFoundException (ensure)', async () => {
      const { service } = setup();
      await expect(
        service.updateStatus('нет-такого', 'co-1', ProductionStatus.COMPLETED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('перевод в COMPLETED со списанием материалов (одна транзакция, P0-8)', () => {
    const base: FixtureOpts = {
      items: [{ quantity: 3, materials: [{ productId: 'p-A', qtyPerUnit: 2 }] }],
      products: [{ id: 'p-A', purchasePrice: 10 }],
      stock: [{ productId: 'p-A', branchId: 'br-1', quantity: 100 }],
      orderStatus: OrderStatus.READY, // заказ уже READY → syncOrderStatus не шумит
    };

    it('happy-path: списание и статус COMPLETED — внутри одного $transaction-колбэка', async () => {
      const { service, db, audit, job, stockQty, writeOffFor } = setup(base);

      const res = await service.updateStatus(
        'job-1',
        'co-1',
        ProductionStatus.COMPLETED,
        undefined,
        'user-9',
      );

      // Ровно одна транзакция, и это КОЛБЭК-форма (списание+статус вместе).
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(typeof db.$transaction.mock.calls[0][0]).toBe('function');

      // Материалы списаны: остаток уменьшился на 2*3 = 6.
      expect(stockQty('p-A')).toBe(94);
      const mv = writeOffFor('p-A');
      expect(mv).toMatchObject({
        type: StockMovementType.WRITE_OFF,
        productId: 'p-A',
        branchId: 'br-1',
        quantity: 6,
        beforeQty: 100,
        afterQty: 94,
        orderId: 'ord-1',
        productionJobId: 'job-1',
        userId: 'user-9',
      });

      // Флаг проставлен, статус/времена выставлены — задание реально COMPLETED.
      expect(job.materialsWrittenOff).toBe(true);
      expect(res.status).toBe(ProductionStatus.COMPLETED);
      expect(res.completedAt).toBeInstanceOf(Date);
      expect(res.startedAt).toBeInstanceOf(Date); // проставился, т.к. был null

      // Финальный апдейт статуса произошёл В ТОЙ ЖЕ транзакции (после списания).
      expect(db.productionJob.update).toHaveBeenCalledTimes(1);
      expect(db.productionJob.update.mock.calls[0][0].data.status).toBe(
        ProductionStatus.COMPLETED,
      );
      // Сводный аудит списания.
      expect(audit.recordTx).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ action: 'stock:production-writeoff' }),
      );
    });

    it('нехватка остатка → BadRequest, задание НЕ становится COMPLETED (откат, P0-8)', async () => {
      const { service, db, stockQty } = setup({
        ...base,
        stock: [{ productId: 'p-A', branchId: 'br-1', quantity: 3 }], // нужно 6
      });

      await expect(
        service.updateStatus('job-1', 'co-1', ProductionStatus.COMPLETED),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Финальный апдейт статуса НЕ выполнился — COMPLETED не зафиксирован.
      expect(db.productionJob.update).not.toHaveBeenCalled();
      // Единственное списание провалилось по guard'у → остаток не тронут.
      expect(stockQty('p-A')).toBe(3);
      expect(db.stockMovement.create).not.toHaveBeenCalled();
      // Заказ не синхронизировался (до syncOrderStatus не дошли).
      expect(db.order.update).not.toHaveBeenCalled();
    });

    it('идемпотентность: повторное завершение уже списанного задания НЕ списывает снова', async () => {
      const { service, db, stockQty } = setup({
        ...base,
        job: { status: ProductionStatus.COMPLETED, materialsWrittenOff: true },
        siblings: [{ status: ProductionStatus.COMPLETED }],
        orderStatus: OrderStatus.READY,
      });

      const res = await service.updateStatus(
        'job-1',
        'co-1',
        ProductionStatus.COMPLETED,
      );

      // Ни транзакции списания, ни движения, ни изменения остатка.
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.stockMovement.create).not.toHaveBeenCalled();
      expect(stockQty('p-A')).toBe(100);
      expect(res.status).toBe(ProductionStatus.COMPLETED);
      // Обычный (внетранзакционный) апдейт всё же был.
      expect(db.productionJob.update).toHaveBeenCalledTimes(1);
    });

    it('заказ без филиала (branchId=null): завершаем, но списание пропускаем и предупреждаем (P1-116)', async () => {
      const { service, db, job, warnSpy } = setup({
        ...base,
        branchId: null,
        orderStatus: OrderStatus.READY,
      });

      const res = await service.updateStatus(
        'job-1',
        'co-1',
        ProductionStatus.COMPLETED,
      );

      expect(res.status).toBe(ProductionStatus.COMPLETED);
      expect(db.stockMovement.create).not.toHaveBeenCalled();
      // claim до флага не дошёл — materialsWrittenOff остаётся false.
      expect(job.materialsWrittenOff).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ord-1'),
      );
    });
  });

  describe('снимок себестоимости на списании (unitCost/totalCost, P1-2)', () => {
    it('unitCost = purchasePrice, totalCost = round(unitCost*qty,4); нет цены → 0', async () => {
      const { service, writeOffFor } = setup({
        orderStatus: OrderStatus.READY,
        items: [
          {
            quantity: 3,
            materials: [
              { productId: 'p-A', qtyPerUnit: 2 }, // qty 6
              { productId: 'p-B', qtyPerUnit: 1 }, // qty 3
              { productId: 'p-C', qtyPerUnit: 4 }, // qty 12
            ],
          },
        ],
        products: [
          { id: 'p-A', purchasePrice: 10 },
          { id: 'p-B', purchasePrice: 1.23456 }, // проверка округления до 4 знаков
          { id: 'p-C', purchasePrice: null }, // нет себестоимости → 0
        ],
        stock: [
          { productId: 'p-A', branchId: 'br-1', quantity: 1000 },
          { productId: 'p-B', branchId: 'br-1', quantity: 1000 },
          { productId: 'p-C', branchId: 'br-1', quantity: 1000 },
        ],
      });

      await service.updateStatus('job-1', 'co-1', ProductionStatus.COMPLETED);

      const a = writeOffFor('p-A');
      expect(a.unitCost).toBe(10);
      expect(a.totalCost).toBe(60);

      const b = writeOffFor('p-B');
      expect(b.quantity).toBe(3);
      expect(b.unitCost).toBe(1.23456);
      // 1.23456 * 3 = 3.70368 → round(...,4) = 3.7037
      expect(b.totalCost).toBe(3.7037);

      const c = writeOffFor('p-C');
      expect(c.quantity).toBe(12);
      expect(c.unitCost).toBe(0);
      expect(c.totalCost).toBe(0);
    });

    it('один товар в двух позициях заказа агрегируется в одно списание (сумма qty)', async () => {
      const { service, writeOffFor, stockQty } = setup({
        orderStatus: OrderStatus.READY,
        items: [
          { quantity: 3, materials: [{ productId: 'p-A', qtyPerUnit: 2 }] }, // 6
          { quantity: 5, materials: [{ productId: 'p-A', qtyPerUnit: 1 }] }, // 5
        ],
        products: [{ id: 'p-A', purchasePrice: 2 }],
        stock: [{ productId: 'p-A', branchId: 'br-1', quantity: 50 }],
      });

      await service.updateStatus('job-1', 'co-1', ProductionStatus.COMPLETED);

      const mv = writeOffFor('p-A');
      expect(mv.quantity).toBe(11); // 6 + 5 — одно движение, не два
      expect(mv.totalCost).toBe(22); // 2 * 11
      expect(stockQty('p-A')).toBe(39); // 50 - 11
    });
  });

  describe('реверс списания при уходе из COMPLETED (P1-97)', () => {
    it('COMPLETED → REWORK: материалы возвращаются на склад, себестоимость восстановлена', async () => {
      const { service, db, audit, job, stockQty, inFor } = setup({
        job: { status: ProductionStatus.COMPLETED, materialsWrittenOff: true },
        orderStatus: OrderStatus.IN_PROGRESS,
        siblings: [{ status: ProductionStatus.REWORK }],
        // остаток уже после прежнего списания 6 (100 → 94)
        stock: [{ productId: 'p-A', branchId: 'br-1', quantity: 94 }],
        movements: [
          {
            productId: 'p-A',
            branchId: 'br-1',
            type: StockMovementType.WRITE_OFF,
            quantity: 6,
            unitCost: 10,
          },
        ],
      });

      const res = await service.updateStatus(
        'job-1',
        'co-1',
        ProductionStatus.REWORK,
        'брак печати',
        'user-9',
      );

      // Реверс — тоже в колбэк-транзакции.
      expect(typeof db.$transaction.mock.calls[0][0]).toBe('function');
      // Остаток вернулся: 94 + 6 = 100.
      expect(stockQty('p-A')).toBe(100);
      const back = inFor('p-A');
      expect(back).toMatchObject({
        type: StockMovementType.IN,
        quantity: 6,
        unitCost: 10, // средневзвешенная себестоимость списаний
        totalCost: 60,
        productionJobId: 'job-1',
      });
      // Флаг снят, статус/причина брака выставлены, completedAt сброшен.
      expect(job.materialsWrittenOff).toBe(false);
      expect(res.status).toBe(ProductionStatus.REWORK);
      expect(res.defectReason).toBe('брак печати');
      expect(res.completedAt).toBeNull();
      expect(audit.recordTx).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ action: 'stock:production-writeoff-reverse' }),
      );
    });

    it('несколько циклов: возвращается только НЕПОГАШЕННЫЙ объём (нетто), не весь списанный', async () => {
      const { service, stockQty, inFor } = setup({
        job: { status: ProductionStatus.COMPLETED, materialsWrittenOff: true },
        orderStatus: OrderStatus.IN_PROGRESS,
        siblings: [{ status: ProductionStatus.REWORK }],
        stock: [{ productId: 'p-A', branchId: 'br-1', quantity: 88 }],
        // Списано 6 + 6 = 12, ранее возвращено 6 → нетто к возврату = 6.
        movements: [
          { productId: 'p-A', branchId: 'br-1', type: StockMovementType.WRITE_OFF, quantity: 6, unitCost: 10 },
          { productId: 'p-A', branchId: 'br-1', type: StockMovementType.IN, quantity: 6, unitCost: 10 },
          { productId: 'p-A', branchId: 'br-1', type: StockMovementType.WRITE_OFF, quantity: 6, unitCost: 10 },
        ],
      });

      await service.updateStatus('job-1', 'co-1', ProductionStatus.REWORK, 'повтор');

      // Возврат ровно 6 (нетто), а не 12 (всё списанное).
      const back = inFor('p-A');
      expect(back.quantity).toBe(6);
      expect(stockQty('p-A')).toBe(94); // 88 + 6
    });
  });

  describe('syncOrderStatus: продвижение и защита терминальных статусов (P0-9)', () => {
    it('все задания COMPLETED → заказ продвигается в READY', async () => {
      const { service, db } = setup({
        items: [{ quantity: 3, materials: [{ productId: 'p-A', qtyPerUnit: 2 }] }],
        products: [{ id: 'p-A', purchasePrice: 10 }],
        stock: [{ productId: 'p-A', branchId: 'br-1', quantity: 100 }],
        orderStatus: OrderStatus.IN_PROGRESS, // ещё не READY → должен продвинуться
        siblings: [{ status: ProductionStatus.COMPLETED }],
      });

      await service.updateStatus('job-1', 'co-1', ProductionStatus.COMPLETED);

      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ord-1' },
          data: { status: OrderStatus.READY },
        }),
      );
      expect(db.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderId: 'ord-1', status: OrderStatus.READY, reason: 'auto production' },
        }),
      );
    });

    it('рабочий статус на не-терминальном заказе → продвижение в IN_PROGRESS', async () => {
      const { service, db } = setup({
        job: { status: ProductionStatus.PENDING, materialsWrittenOff: false },
        orderStatus: OrderStatus.ACCEPTED,
        siblings: [{ status: ProductionStatus.PRINTING }],
      });

      const res = await service.updateStatus(
        'job-1',
        'co-1',
        ProductionStatus.PRINTING,
      );

      // Не COMPLETED и не было списания → ни одной КОЛБЭК-транзакции (write-off/
      // reverse) и ни одного движения склада. Массив-транзакция продвижения
      // заказа при этом допустима (её проверяем ниже).
      const usedCallbackTx = db.$transaction.mock.calls.some(
        (c: any[]) => typeof c[0] === 'function',
      );
      expect(usedCallbackTx).toBe(false);
      expect(db.stockMovement.create).not.toHaveBeenCalled();
      expect(res.startedAt).toBeInstanceOf(Date); // старт зафиксирован
      expect(res.completedAt).toBeNull();
      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: OrderStatus.IN_PROGRESS } }),
      );
    });

    it.each([OrderStatus.DELIVERED, OrderStatus.CANCELLED])(
      'терминальный заказ (%s) НЕ откатывается обратно в производство',
      async (terminal) => {
        const { service, db } = setup({
          job: { status: ProductionStatus.PENDING, materialsWrittenOff: false },
          orderStatus: terminal,
          siblings: [{ status: ProductionStatus.REWORK }], // дал бы IN_PROGRESS
        });

        const res = await service.updateStatus(
          'job-1',
          'co-1',
          ProductionStatus.REWORK,
          'поздний брак',
        );

        expect(res.status).toBe(ProductionStatus.REWORK);
        // Главное: статус заказа НЕ трогаем.
        expect(db.order.update).not.toHaveBeenCalled();
        expect(db.orderStatusHistory.create).not.toHaveBeenCalled();
      },
    );
  });

  /**
   * Правила, которым нужна ЖИВАЯ БД (реальная транзакция Prisma) — на статэфул-моке
   * их нельзя проверить честно, т.к. мок не откатывает частично применённые
   * мутации и не даёт настоящей атомарности updateMany под конкуренцией.
   * Оформлены как todo, чтобы не держать красный/флейки-тест.
   */
  it.todo(
    'ЖИВАЯ БД: частичный сбой списания (первый товар списан, второму не хватило) ' +
      'откатывает ВСЮ транзакцию — остаток первого восстановлен, materialsWrittenOff=false',
  );
  it.todo(
    'ЖИВАЯ БД: параллельное завершение одного задания (гонка) списывает материалы ' +
      'ровно один раз — атомарный claim updateMany(materialsWrittenOff:false→true)',
  );
});
