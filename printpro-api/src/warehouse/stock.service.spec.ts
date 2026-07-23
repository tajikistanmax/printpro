import { BadRequestException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { StockService } from './stock.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

/**
 * Юнит-тесты бизнес-правил склада (приход/списание/перемещение/пересчёт).
 *
 * Сервис работает целиком внутри prisma.$transaction(async (tx) => …). Поэтому
 * мокаем $transaction так, что он ПРОСТО вызывает переданный колбэк с фейковым
 * `tx`, а сами модели tx — jest.fn с настраиваемыми ответами. Так мы честно
 * проверяем РЕАЛЬНУЮ логику сервиса: какие запросы он выдаёт (increment/decrement,
 * условие `quantity >= …`, идемпотентный short-circuit) и как реагирует на их
 * результат (count===0 → отказ без движения; dup → возврат без повторного
 * применения; diff → запись ADJUST). Гарантии, требующие ЖИВОЙ БД (реальная
 * атомарность под гонкой, FOR UPDATE, unique-индекс) вынесены в it.todo ниже.
 */

const COMPANY = 'company-1';
const PRODUCT = 'product-1';
const BRANCH = 'branch-1';
const FROM = 'branch-from';
const TO = 'branch-to';
const USER = 'user-1';

type AnyMock = jest.Mock<any, any>;

// Фейковый транзакционный клиент: все модели/методы, к которым обращается сервис.
function createTx() {
  return {
    product: { findFirst: jest.fn() as AnyMock },
    branch: { findFirst: jest.fn() as AnyMock },
    stock: {
      upsert: jest.fn() as AnyMock,
      updateMany: jest.fn() as AnyMock,
      findUnique: jest.fn() as AnyMock,
    },
    stockMovement: {
      findFirst: jest.fn() as AnyMock,
      create: jest.fn() as AnyMock,
      createMany: jest.fn() as AnyMock,
    },
    writeOff: {
      findFirst: jest.fn() as AnyMock,
      create: jest.fn() as AnyMock,
    },
    auditLog: { create: jest.fn() as AnyMock },
    $queryRaw: jest.fn() as AnyMock,
  };
}

type Tx = ReturnType<typeof createTx>;

// PrismaService-мок: $transaction прогоняет колбэк с нашим tx; плюс прямые
// (нетранзакционные) методы для listStock/stats/lowStock.
function createPrisma(tx: Tx) {
  return {
    $transaction: jest.fn(async (arg: any, _opts?: any) => {
      // В сервисе используется только форма с колбэком: $transaction(fn, opts?).
      if (typeof arg === 'function') return arg(tx);
      throw new Error('unexpected $transaction(array) in these tests');
    }) as AnyMock,
    stock: { findMany: jest.fn() as AnyMock },
    supplier: { count: jest.fn() as AnyMock },
    stockReceiptItem: { findMany: jest.fn() as AnyMock },
    writeOff: { findMany: jest.fn() as AnyMock },
    product: { findMany: jest.fn() as AnyMock },
  };
}

function createAudit() {
  return {
    recordTx: jest.fn().mockResolvedValue(undefined) as AnyMock,
    record: jest.fn().mockResolvedValue(undefined) as AnyMock,
  };
}

describe('StockService — бизнес-правила склада', () => {
  let tx: Tx;
  let prisma: ReturnType<typeof createPrisma>;
  let audit: ReturnType<typeof createAudit>;
  let service: StockService;

  beforeEach(() => {
    tx = createTx();
    prisma = createPrisma(tx);
    audit = createAudit();
    service = new StockService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    // Разумные дефолты happy-path: товар и филиал существуют, дублей нет.
    tx.product.findFirst.mockResolvedValue({ id: PRODUCT, purchasePrice: 100 });
    tx.branch.findFirst.mockResolvedValue({ id: BRANCH });
    tx.stockMovement.findFirst.mockResolvedValue(null);
    tx.stockMovement.create.mockResolvedValue({});
    tx.stockMovement.createMany.mockResolvedValue({ count: 2 });
    tx.stock.upsert.mockResolvedValue({});
    tx.stock.updateMany.mockResolvedValue({ count: 1 });
    tx.stock.findUnique.mockResolvedValue({ quantity: 0 });
    tx.writeOff.findFirst.mockResolvedValue(null);
    tx.writeOff.create.mockResolvedValue({ id: 'wo-1' });
    tx.$queryRaw.mockResolvedValue([]);
  });

  // ─────────────────────────────── ПРИХОД ───────────────────────────────
  describe('receive (приход) — увеличивает остаток', () => {
    it('happy: увеличивает остаток (increment), пишет движение IN с корректными до/после', async () => {
      // upsert под блокировкой строки вернул факт «после» = 15 (было 5, пришло 10)
      const stockRow = {
        id: 's-1',
        quantity: 15,
        product: { id: PRODUCT },
        branch: { id: BRANCH },
      };
      tx.stock.upsert.mockResolvedValue(stockRow);

      const res = await service.receive({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        quantity: 10,
        userId: USER,
      } as any);

      // именно increment — приход НЕ перезаписывает остаток
      expect(tx.stock.upsert).toHaveBeenCalledTimes(1);
      expect(tx.stock.upsert.mock.calls[0][0].update).toEqual({
        quantity: { increment: 10 },
      });
      expect(tx.stock.upsert.mock.calls[0][0].where).toEqual({
        productId_branchId: { productId: PRODUCT, branchId: BRANCH },
      });

      // движение IN: after = факт из upsert (15), before выводится вычитанием дельты (5)
      const mv = tx.stockMovement.create.mock.calls[0][0].data;
      expect(mv.type).toBe(StockMovementType.IN);
      expect(mv.quantity).toBe(10);
      expect(mv.beforeQty).toBe(5);
      expect(mv.afterQty).toBe(15);

      // след в аудите остаётся (нет движения склада без записи)
      expect(audit.recordTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: 'stock:receive' }),
      );
      expect(res).toBe(stockRow);
    });

    it('несуществующий товар → BadRequest, остаток не трогаем', async () => {
      tx.product.findFirst.mockResolvedValue(null);
      await expect(
        service.receive({
          companyId: COMPANY,
          branchId: BRANCH,
          productId: 'nope',
          quantity: 10,
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(tx.stock.upsert).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('несуществующий филиал → BadRequest', async () => {
      tx.branch.findFirst.mockResolvedValue(null);
      await expect(
        service.receive({
          companyId: COMPANY,
          branchId: 'nope',
          productId: PRODUCT,
          quantity: 10,
        } as any),
      ).rejects.toThrow('Branch not found');
      expect(tx.stock.upsert).not.toHaveBeenCalled();
    });

    it('идемпотентность: повтор того же ключа НЕ задваивает приход', async () => {
      // движение с этим ключом уже есть → это ретрай/двойной клик
      tx.stockMovement.findFirst.mockResolvedValue({ id: 'existing' });
      const current = { id: 's-1', quantity: 15, product: {}, branch: {} };
      tx.stock.findUnique.mockResolvedValue(current);

      const res = await service.receive({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        quantity: 10,
        idempotencyKey: 'key-1',
      } as any);

      // ключевое: НЕТ повторного increment и НЕТ второго движения
      expect(tx.stock.upsert).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      // возвращаем текущий остаток как есть
      expect(res).toBe(current);
    });
  });

  // ────────────────────────── СПИСАНИЕ / КОРРЕКТИРОВКА ──────────────────────────
  describe('adjust (списание/корректировка) — уменьшает остаток', () => {
    it('приходные типы IN/RETURN отвергаются ещё до транзакции', async () => {
      for (const type of [StockMovementType.IN, StockMovementType.RETURN]) {
        await expect(
          service.adjust({
            companyId: COMPANY,
            branchId: BRANCH,
            productId: PRODUCT,
            quantity: 5,
            type,
          } as any),
        ).rejects.toThrow(BadRequestException);
      }
      // до $transaction дело не дошло — приход тут не оформляют
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('защита от перерасхода: не хватает остатка → отказ, движение НЕ пишется', async () => {
      // условный decrement (quantity >= требуемого) не нашёл строку
      tx.stock.updateMany.mockResolvedValue({ count: 0 });
      tx.stock.findUnique.mockResolvedValue({ quantity: 3 });

      await expect(
        service.adjust({
          companyId: COMPANY,
          branchId: BRANCH,
          productId: PRODUCT,
          quantity: 10,
          type: StockMovementType.ADJUST,
        } as any),
      ).rejects.toThrow('Недостаточно товара на складе. Доступно: 3');

      // именно условное списание с проверкой gte (нельзя увести в минус)
      expect(tx.stock.updateMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          productId: PRODUCT,
          branchId: BRANCH,
          quantity: { gte: 10 },
        }),
      );
      // на неуспехе движение не создаётся
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('happy: условно уменьшает, пишет движение с корректными до/после', async () => {
      tx.stock.updateMany.mockResolvedValue({ count: 1 });
      // после списания 3 из 10 осталось 7
      const after = { quantity: 7, product: {}, branch: {} };
      tx.stock.findUnique.mockResolvedValue(after);

      const res = await service.adjust({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        quantity: 3,
        type: StockMovementType.ADJUST,
        userId: USER,
      } as any);

      expect(tx.stock.updateMany.mock.calls[0][0].data).toEqual({
        quantity: { decrement: 3 },
      });
      const mv = tx.stockMovement.create.mock.calls[0][0].data;
      expect(mv.type).toBe(StockMovementType.ADJUST);
      expect(mv.quantity).toBe(3);
      expect(mv.beforeQty).toBe(10); // 7 + 3
      expect(mv.afterQty).toBe(7);
      expect(res).toBe(after);
    });

    it('идемпотентность: повтор ключа → остаток не меняем', async () => {
      tx.stockMovement.findFirst.mockResolvedValue({ id: 'dup' });
      const current = { quantity: 7, product: {}, branch: {} };
      tx.stock.findUnique.mockResolvedValue(current);

      const res = await service.adjust({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        quantity: 3,
        type: StockMovementType.ADJUST,
        idempotencyKey: 'key-adj',
      } as any);

      expect(tx.stock.updateMany).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(res).toBe(current);
    });
  });

  // ─────────────────────────── ПЕРЕМЕЩЕНИЕ ───────────────────────────
  describe('transfer (перемещение между филиалами)', () => {
    it('одинаковые филиалы → BadRequest ещё до транзакции', async () => {
      await expect(
        service.transfer({
          companyId: COMPANY,
          productId: PRODUCT,
          fromBranchId: BRANCH,
          toBranchId: BRANCH,
          quantity: 5,
        } as any),
      ).rejects.toThrow('Филиалы должны отличаться');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('защита от перерасхода в источнике: не хватает → отказ, приёмник не пополняется', async () => {
      tx.stock.updateMany.mockResolvedValue({ count: 0 });
      tx.stock.findUnique.mockResolvedValue({ quantity: 2 });

      await expect(
        service.transfer({
          companyId: COMPANY,
          productId: PRODUCT,
          fromBranchId: FROM,
          toBranchId: TO,
          quantity: 10,
        } as any),
      ).rejects.toThrow('Недостаточно товара в филиале-источнике. Доступно: 2');

      // источник списывается условно (gte), приёмник НЕ пополняется, движений нет
      expect(tx.stock.updateMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ branchId: FROM, quantity: { gte: 10 } }),
      );
      expect(tx.stock.upsert).not.toHaveBeenCalled();
      expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
    });

    it('happy: два движения OUT(источник)+IN(приёмник), приёмник пополнен, ключ висит на OUT', async () => {
      tx.stock.updateMany.mockResolvedValue({ count: 1 });
      // источник после decrement = 5 → доступно было 15; приёмник до = 2
      tx.stock.findUnique.mockImplementation(async (args: any) => {
        const b = args.where.productId_branchId.branchId;
        if (b === FROM) return { quantity: 5 };
        if (b === TO) return { quantity: 2 };
        return null;
      });

      const res = await service.transfer({
        companyId: COMPANY,
        productId: PRODUCT,
        fromBranchId: FROM,
        toBranchId: TO,
        quantity: 10,
        idempotencyKey: 'key-tr',
      } as any);

      // приёмник пополняется increment-ом
      expect(tx.stock.upsert.mock.calls[0][0].where.productId_branchId.branchId).toBe(TO);
      expect(tx.stock.upsert.mock.calls[0][0].update).toEqual({
        quantity: { increment: 10 },
      });

      const rows = tx.stockMovement.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      // OUT из источника
      expect(rows[0]).toEqual(
        expect.objectContaining({
          branchId: FROM,
          type: StockMovementType.OUT,
          beforeQty: 15,
          afterQty: 5,
          idempotencyKey: 'key-tr',
        }),
      );
      // IN в приёмник (без ключа идемпотентности — он на OUT)
      expect(rows[1]).toEqual(
        expect.objectContaining({
          branchId: TO,
          type: StockMovementType.IN,
          beforeQty: 2,
          afterQty: 12,
        }),
      );
      expect(rows[1].idempotencyKey).toBeUndefined();
      expect(res).toEqual({ ok: true });
    });

    it('идемпотентность: повтор ключа → ничего не двигаем', async () => {
      tx.stockMovement.findFirst.mockResolvedValue({ id: 'dup' });
      const res = await service.transfer({
        companyId: COMPANY,
        productId: PRODUCT,
        fromBranchId: FROM,
        toBranchId: TO,
        quantity: 10,
        idempotencyKey: 'key-tr',
      } as any);
      expect(tx.stock.updateMany).not.toHaveBeenCalled();
      expect(tx.stock.upsert).not.toHaveBeenCalled();
      expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
      expect(res).toEqual({ ok: true });
    });
  });

  // ─────────────────────────── ПЕРЕСЧЁТ (ИНВЕНТАРИЗАЦИЯ) ───────────────────────────
  describe('recount (инвентаризация) — абсолютная перезапись остатка', () => {
    it('недостача: было 10, насчитали 7 → перезапись + ADJUST на модуль расхождения', async () => {
      tx.$queryRaw.mockResolvedValue([{ quantity: '10' }]); // FOR UPDATE вернул «было»

      const res = await service.recount({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        countedQuantity: 7,
        userId: USER,
      } as any);

      // перезапись (не increment/decrement) на фактическое значение
      expect(tx.stock.upsert.mock.calls[0][0].update).toEqual({ quantity: 7 });

      const mv = tx.stockMovement.create.mock.calls[0][0].data;
      expect(mv.type).toBe(StockMovementType.ADJUST);
      expect(mv.quantity).toBe(3); // |7 - 10|
      expect(mv.beforeQty).toBe(10);
      expect(mv.afterQty).toBe(7);

      expect(res).toEqual({ ok: true, was: 10, now: 7, diff: -3 });
    });

    it('нет расхождения (diff=0) → движение НЕ пишется', async () => {
      tx.$queryRaw.mockResolvedValue([{ quantity: '5' }]);
      const res = await service.recount({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        countedQuantity: 5,
      } as any);
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(res).toEqual({ ok: true, was: 5, now: 5, diff: 0 });
    });

    it('строки стока ещё нет → было 0, создаём и фиксируем излишек', async () => {
      tx.$queryRaw.mockResolvedValue([]); // строки нет
      const res = await service.recount({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        countedQuantity: 8,
      } as any);
      expect(res).toEqual({ ok: true, was: 0, now: 8, diff: 8 });
      const mv = tx.stockMovement.create.mock.calls[0][0].data;
      expect(mv.quantity).toBe(8);
      expect(mv.beforeQty).toBe(0);
      expect(mv.afterQty).toBe(8);
    });
  });

  describe('recountBulk (массовая инвентаризация)', () => {
    it('считает applied/unchanged/skipped; чужой товар пропускает, минус игнорит', async () => {
      // p1: было 2, насчитали 5 → applied; p2: было 4, насчитали 4 → unchanged;
      // pX: неизвестен → skipped; p-neg: отрицательное → тихо пропущено (нигде не учтено)
      tx.product.findFirst
        .mockResolvedValueOnce({ id: 'p1' }) // p1 известен
        .mockResolvedValueOnce({ id: 'p2' }) // p2 известен
        .mockResolvedValueOnce(null); // pX неизвестен
      tx.$queryRaw
        .mockResolvedValueOnce([{ quantity: '2' }]) // p1 было 2
        .mockResolvedValueOnce([{ quantity: '4' }]); // p2 было 4

      const res = await service.recountBulk(
        COMPANY,
        BRANCH,
        [
          { productId: 'p1', countedQuantity: 5 },
          { productId: 'p2', countedQuantity: 4 },
          { productId: 'pX', countedQuantity: 9 },
          { productId: 'p-neg', countedQuantity: -1 },
        ],
        USER,
      );

      expect(res).toEqual({ applied: 1, unchanged: 1, skipped: 1 });
      // применилась ровно одна перезапись (p1) и одно движение
      expect(tx.stock.upsert).toHaveBeenCalledTimes(1);
      expect(tx.stock.upsert.mock.calls[0][0].update).toEqual({ quantity: 5 });
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    });

    it('пустой branchId → BadRequest', async () => {
      await expect(
        service.recountBulk(COMPANY, '', [], USER),
      ).rejects.toThrow('Не указан филиал');
    });
  });

  // ─────────────────────────── СПИСАНИЕ (БОЙ/БРАК) ───────────────────────────
  describe('writeOff (бой/брак/порча)', () => {
    it('защита от перерасхода: не хватает → отказ, документ и движение НЕ создаются', async () => {
      tx.stock.updateMany.mockResolvedValue({ count: 0 });
      tx.stock.findUnique.mockResolvedValue({ quantity: 1 });

      await expect(
        service.writeOff({
          companyId: COMPANY,
          branchId: BRANCH,
          productId: PRODUCT,
          quantity: 5,
          reason: 'бой',
        } as any),
      ).rejects.toThrow('Недостаточно товара для списания. Доступно: 1');

      expect(tx.writeOff.create).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('happy: себестоимость = закупка × кол-во, движение WRITE_OFF, возврат документа', async () => {
      tx.product.findFirst.mockResolvedValue({ id: PRODUCT, purchasePrice: 5 });
      tx.stock.updateMany.mockResolvedValue({ count: 1 });
      tx.stock.findUnique.mockResolvedValue({ quantity: 8 }); // осталось после списания
      const doc = { id: 'wo-1', cost: 10 };
      tx.writeOff.create.mockResolvedValue(doc);

      const res = await service.writeOff({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        quantity: 2,
        reason: 'брак',
      } as any);

      // cost = purchasePrice(5) * quantity(2)
      expect(tx.writeOff.create.mock.calls[0][0].data.cost).toBe(10);
      const mv = tx.stockMovement.create.mock.calls[0][0].data;
      expect(mv.type).toBe(StockMovementType.WRITE_OFF);
      expect(mv.beforeQty).toBe(10); // 8 + 2
      expect(mv.afterQty).toBe(8);
      expect(res).toBe(doc);
    });

    it('идемпотентность: повтор ключа → существующий документ, повторно не списываем', async () => {
      const existing = { id: 'wo-existing', cost: 10 };
      tx.writeOff.findFirst.mockResolvedValue(existing);

      const res = await service.writeOff({
        companyId: COMPANY,
        branchId: BRANCH,
        productId: PRODUCT,
        quantity: 2,
        idempotencyKey: 'key-wo',
      } as any);

      expect(tx.stock.updateMany).not.toHaveBeenCalled();
      expect(tx.writeOff.create).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(res).toBe(existing);
    });
  });

  // ─────────────────────────── ВЫБОРКИ / ПОРОГИ ───────────────────────────
  describe('listStock — мягко удалённые товары исключены из остатков', () => {
    it('фильтрует по product.deletedAt: null', async () => {
      prisma.stock.findMany.mockResolvedValue([]);
      await service.listStock(COMPANY);
      expect(prisma.stock.findMany.mock.calls[0][0].where).toEqual({
        product: { companyId: COMPANY, deletedAt: null },
      });
    });
  });

  describe('stats — поступления за сегодня без мягко удалённых приёмок', () => {
    it('исключает удалённые приёмки и суммирует cost×quantity', async () => {
      prisma.supplier.count.mockResolvedValue(3);
      prisma.stockReceiptItem.findMany.mockResolvedValue([
        { cost: 10, quantity: 2 },
        { cost: 5, quantity: 4 },
      ]);

      const res = await service.stats(COMPANY);

      const where = prisma.stockReceiptItem.findMany.mock.calls[0][0].where;
      // сама позиция не удалена И её приёмка не удалена (иначе завышаем «сегодня»)
      expect(where.deletedAt).toBeNull();
      expect(where.receipt).toEqual(
        expect.objectContaining({ companyId: COMPANY, deletedAt: null }),
      );
      expect(res).toEqual({ suppliers: 3, todayReceipts: 40 }); // 10*2 + 5*4
    });
  });

  describe('lowStock — товары на пороге/ниже порога', () => {
    it('оставляет только те, где остаток <= minStock (включая равенство)', async () => {
      prisma.stock.findMany.mockResolvedValue([
        {
          productId: 'low',
          quantity: 2,
          product: { name: 'Мало', minStock: 5, unit: { shortName: 'шт' } },
          branch: { name: 'Ф1' },
        },
        {
          productId: 'ok',
          quantity: 10,
          product: { name: 'Хватает', minStock: 5, unit: { shortName: 'шт' } },
          branch: { name: 'Ф1' },
        },
        {
          productId: 'edge',
          quantity: 5,
          product: { name: 'Ровно', minStock: 5, unit: { shortName: 'шт' } },
          branch: { name: 'Ф1' },
        },
      ]);

      const res = await service.lowStock(COMPANY);

      const ids = res.map((r) => r.productId);
      expect(ids).toEqual(['low', 'edge']); // 'ok' (10 > 5) отфильтрован, граница 5<=5 попадает
      expect(res[0]).toEqual(
        expect.objectContaining({
          productId: 'low',
          quantity: 2,
          minStock: 5,
          unit: 'шт',
          branch: 'Ф1',
        }),
      );
    });
  });

  // ───────────── Гарантии, которые честно проверяются только на ЖИВОЙ БД ─────────────
  // Здесь мок доказывает лишь, что сервис ВЫДАЁТ верный условный запрос и реагирует
  // на его результат. Реальную атомарность/блокировки/unique обеспечивает Postgres —
  // это интеграционные тесты на живой базе, не юнит-моки.
  it.todo(
    'ЖИВАЯ БД: две параллельные adjust/transfer не уводят остаток в минус (атомарность updateMany quantity>=… под конкуренцией)',
  );
  it.todo(
    'ЖИВАЯ БД: recount под FOR UPDATE не теряет конкурентную продажу/приход между чтением «было» и перезаписью (lost update)',
  );
  it.todo(
    'ЖИВАЯ БД: гонка одинакового idempotencyKey — вторая транзакция падает на unique-индексе (P2002) и откатывается целиком',
  );
});
