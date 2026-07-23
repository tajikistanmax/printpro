import { BadRequestException } from '@nestjs/common';
import { DiscountType } from '@prisma/client';
import { PromocodesService } from './promocodes.service';

/**
 * Unit-тесты сервиса промокодов на моках Prisma (без живой БД).
 *
 * ФОКУС: атомарный consume() — списание использования проходит ТОЛЬКО если код
 * одновременно активен (isActive), не истёк (validUntil) И не исчерпан (лимит).
 * Проверяем, что это именно «и то, и другое, и третье», а НЕ только лимит:
 *   1) поведенчески — каждая из трёх причин по отдельности блокирует списание;
 *   2) структурно — в атомарном where реально присутствуют все три условия.
 *
 * Сервис инстанцируется напрямую с мок-Prisma, т.к. consume()/release() не
 * выведены в HTTP-контроллер и живут на уровне сервиса.
 */

const COMPANY = 'company-1';

// Запись промокода в том виде, в каком её возвращает Prisma. value кладём числом
// (в БД это Decimal, но сервис приводит через Number(promo.value) — число подходит).
function promo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promo-1',
    companyId: COMPANY,
    code: 'SALE10',
    deletedAt: null as Date | null,
    discountType: DiscountType.PERCENT,
    value: 10,
    maxUses: null as number | null,
    usedCount: 0,
    validUntil: null as Date | null,
    isActive: true,
    ...overrides,
  };
}

// Сентинел Prisma field-reference, который сервис использует в атомарном where
// для сравнения usedCount < maxUses (this.prisma.promoCode.fields.maxUses).
const MAXUSES_FIELD = { _ref: 'PromoCode.maxUses' };

type MockPrisma = {
  promoCode: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    fields: { maxUses: unknown };
  };
};

function makePrisma(): MockPrisma {
  return {
    promoCode: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      fields: { maxUses: MAXUSES_FIELD },
    },
  };
}

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 3_600_000);

describe('PromocodesService', () => {
  let prisma: MockPrisma;
  let service: PromocodesService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PromocodesService(prisma as never);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // validate() — расчёт скидки и правила доступности (без списания)
  // ─────────────────────────────────────────────────────────────────────────
  describe('validate()', () => {
    it('код не найден → invalid, скидка 0', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(null);
      const res = await service.validate(COMPANY, 'NOPE', 100);
      expect(res).toEqual({
        valid: false,
        discount: 0,
        message: 'Промокод не найден',
      });
    });

    it('код отключён (isActive=false) → invalid «не найден»', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(promo({ isActive: false }));
      const res = await service.validate(COMPANY, 'SALE10', 100);
      expect(res.valid).toBe(false);
      expect(res.discount).toBe(0);
      expect(res.message).toBe('Промокод не найден');
    });

    it('срок истёк (validUntil в прошлом) → invalid «истёк»', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(
        promo({ validUntil: past() }),
      );
      const res = await service.validate(COMPANY, 'SALE10', 100);
      expect(res.valid).toBe(false);
      expect(res.message).toBe('Срок промокода истёк');
    });

    it('срок в будущем → valid', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(
        promo({ validUntil: future(), value: 10 }),
      );
      const res = await service.validate(COMPANY, 'SALE10', 100);
      expect(res.valid).toBe(true);
      expect(res.discount).toBe(10);
    });

    it('лимит исчерпан (usedCount >= maxUses) → invalid «лимит»', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(
        promo({ maxUses: 3, usedCount: 3 }),
      );
      const res = await service.validate(COMPANY, 'SALE10', 100);
      expect(res.valid).toBe(false);
      expect(res.message).toBe('Лимит использований исчерпан');
    });

    it('лимит ещё есть (usedCount < maxUses) → valid', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(
        promo({ maxUses: 3, usedCount: 2, value: 10 }),
      );
      const res = await service.validate(COMPANY, 'SALE10', 200);
      expect(res.valid).toBe(true);
      expect(res.discount).toBe(20);
      expect(res.code).toBe('SALE10');
    });

    it('код нормализуется (trim + upper) перед поиском', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(promo());
      await service.validate(COMPANY, '  sale10 ', 100);
      const where = prisma.promoCode.findFirst.mock.calls[0][0].where;
      expect(where.code).toBe('SALE10');
      expect(where.companyId).toBe(COMPANY);
      expect(where.deletedAt).toBeNull();
    });

    describe('расчёт скидки (calcDiscount через validate)', () => {
      it('PERCENT: 25% от 200 → 50', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ discountType: DiscountType.PERCENT, value: 25 }),
        );
        const res = await service.validate(COMPANY, 'SALE10', 200);
        expect(res.discount).toBe(50);
      });

      it('PERCENT: округление до 2 знаков (10% от 99.99 → 10.00)', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ discountType: DiscountType.PERCENT, value: 10 }),
        );
        const res = await service.validate(COMPANY, 'SALE10', 99.99);
        // (99.99*10)/100 = 9.999 → toFixed(2) → 10.00
        expect(res.discount).toBe(10);
      });

      it('PERCENT: процент > 100 не даёт скидку больше суммы заказа', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ discountType: DiscountType.PERCENT, value: 150 }),
        );
        const res = await service.validate(COMPANY, 'SALE10', 100);
        expect(res.discount).toBe(100);
      });

      it('FIXED: фиксированная сумма как есть (30 при заказе 120 → 30)', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ discountType: DiscountType.FIXED, value: 30 }),
        );
        const res = await service.validate(COMPANY, 'SALE10', 120);
        expect(res.discount).toBe(30);
      });

      it('FIXED: скидка не превышает сумму заказа (500 при заказе 120 → 120)', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ discountType: DiscountType.FIXED, value: 500 }),
        );
        const res = await service.validate(COMPANY, 'SALE10', 120);
        expect(res.discount).toBe(120);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // consume() — АТОМАРНОЕ списание: isActive + validUntil + лимит (НЕ только лимит)
  // ─────────────────────────────────────────────────────────────────────────
  describe('consume() — атомарное списание', () => {
    describe('отсев на стадии validate (updateMany даже не вызывается)', () => {
      it('отключённый код → BadRequest «не найден», без инкремента', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ isActive: false }),
        );
        await expect(service.consume(COMPANY, 'SALE10', 100)).rejects.toThrow(
          BadRequestException,
        );
        await expect(
          service.consume(COMPANY, 'SALE10', 100),
        ).rejects.toThrow('Промокод не найден');
        expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
      });

      it('истёкший код → BadRequest «истёк», без инкремента', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ validUntil: past() }),
        );
        await expect(
          service.consume(COMPANY, 'SALE10', 100),
        ).rejects.toThrow('Срок промокода истёк');
        expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
      });

      it('исчерпанный лимит → BadRequest «лимит», без инкремента', async () => {
        prisma.promoCode.findFirst.mockResolvedValue(
          promo({ maxUses: 5, usedCount: 5 }),
        );
        await expect(
          service.consume(COMPANY, 'SALE10', 100),
        ).rejects.toThrow('Лимит использований исчерпан');
        expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
      });
    });

    it('happy-path: valid + updateMany count=1 → возвращает скидку и инкрементит usedCount', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(promo({ value: 10 }));
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });

      const discount = await service.consume(COMPANY, 'SALE10', 200);

      expect(discount).toBe(20); // 10% от 200
      expect(prisma.promoCode.updateMany).toHaveBeenCalledTimes(1);
      const arg = prisma.promoCode.updateMany.mock.calls[0][0];
      expect(arg.data).toEqual({ usedCount: { increment: 1 } });
    });

    it('гонка: validate прошёл, но атомарный update ничего не задел (count=0) → BadRequest «недоступен»', async () => {
      // Между validate и update код мог отключиться/истечь/исчерпаться в
      // параллельной продаже. Атомарный where не находит строку → count 0 →
      // сервис ОБЯЗАН отказать, а не «выдать» скидку по устаревшему снимку.
      prisma.promoCode.findFirst.mockResolvedValue(promo({ value: 10 }));
      prisma.promoCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.consume(COMPANY, 'SALE10', 200),
      ).rejects.toThrow('Промокод недоступен');
    });

    it('СТРУКТУРА атомарного where: разом isActive + validUntil + лимит (не только лимит)', async () => {
      prisma.promoCode.findFirst.mockResolvedValue(promo());
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });

      await service.consume(COMPANY, '  sale10 ', 100);

      const where = prisma.promoCode.updateMany.mock.calls[0][0].where;

      // базовая адресация + мультиарендность
      expect(where.companyId).toBe(COMPANY);
      expect(where.code).toBe('SALE10'); // нормализован и в атомарном where
      expect(where.deletedAt).toBeNull();

      // 1) ГАРД АКТИВНОСТИ — списываем только активный код
      expect(where.isActive).toBe(true);

      // 2) ГАРД СРОКА — validUntil = null ИЛИ ещё не истёк (gt now)
      const orValid = where.AND[0].OR;
      expect(orValid).toEqual(
        expect.arrayContaining([{ validUntil: null }]),
      );
      const gtOpt = orValid.find(
        (o: { validUntil?: { gt?: unknown } }) => o.validUntil && o.validUntil.gt,
      );
      expect(gtOpt.validUntil.gt).toBeInstanceOf(Date);
      expect(Math.abs(gtOpt.validUntil.gt.getTime() - Date.now())).toBeLessThan(
        5_000,
      );

      // 3) ГАРД ЛИМИТА — maxUses = null ИЛИ usedCount < maxUses (field-ref)
      const orLimit = where.AND[1].OR;
      expect(orLimit).toEqual(expect.arrayContaining([{ maxUses: null }]));
      const ltOpt = orLimit.find(
        (o: { usedCount?: unknown }) => o.usedCount,
      );
      expect(ltOpt.usedCount.lt).toBe(MAXUSES_FIELD);
    });

    // Поведенческая проверка «не только лимит»: интерпретируем РЕАЛЬНЫЙ where,
    // который построил сервис, против конкретной строки. Симулируем гонку —
    // validate видит валидный снимок, а update видит уже изменившуюся строку.
    describe('каждая из трёх причин по отдельности блокирует атомарное списание', () => {
      let store: ReturnType<typeof promo>;

      // Честная интерпретация условий именно того where, что строит consume().
      function optionMatches(opt: Record<string, any>, rec: any): boolean {
        if ('validUntil' in opt) {
          if (opt.validUntil === null) return rec.validUntil === null;
          if (opt.validUntil?.gt instanceof Date)
            return (
              rec.validUntil !== null &&
              rec.validUntil.getTime() > opt.validUntil.gt.getTime()
            );
        }
        if ('maxUses' in opt && opt.maxUses === null) return rec.maxUses === null;
        if ('usedCount' in opt && opt.usedCount?.lt === MAXUSES_FIELD)
          return rec.maxUses !== null && rec.usedCount < rec.maxUses;
        throw new Error('неожиданная опция OR: ' + JSON.stringify(opt));
      }
      function whereMatches(where: any, rec: any): boolean {
        if (where.companyId !== rec.companyId) return false;
        if (where.code !== rec.code) return false;
        if (where.deletedAt !== rec.deletedAt) return false;
        if (where.isActive !== rec.isActive) return false; // гард активности
        for (const clause of where.AND ?? [])
          if (!(clause.OR ?? []).some((o: any) => optionMatches(o, rec)))
            return false;
        return true;
      }

      beforeEach(() => {
        // validate() всегда видит валидный снимок → проходит.
        prisma.promoCode.findFirst.mockResolvedValue(promo({ value: 10 }));
        // updateMany судит по «текущей» строке store через реальный where.
        prisma.promoCode.updateMany.mockImplementation(
          async ({ where, data }: any) => {
            if (whereMatches(where, store)) {
              if (data?.usedCount?.increment)
                store.usedCount += data.usedCount.increment;
              return { count: 1 };
            }
            return { count: 0 };
          },
        );
      });

      it('строка стала НЕактивной к моменту update → отказ', async () => {
        store = promo({ isActive: false });
        await expect(
          service.consume(COMPANY, 'SALE10', 200),
        ).rejects.toThrow('Промокод недоступен');
        expect(store.usedCount).toBe(0); // ничего не списали
      });

      it('строка ИСТЕКЛА к моменту update → отказ', async () => {
        store = promo({ validUntil: past() });
        await expect(
          service.consume(COMPANY, 'SALE10', 200),
        ).rejects.toThrow('Промокод недоступен');
        expect(store.usedCount).toBe(0);
      });

      it('лимит ИСЧЕРПАН к моменту update → отказ', async () => {
        store = promo({ maxUses: 2, usedCount: 2 });
        await expect(
          service.consume(COMPANY, 'SALE10', 200),
        ).rejects.toThrow('Промокод недоступен');
        expect(store.usedCount).toBe(2);
      });

      it('строка доступна по всем трём условиям → списание проходит', async () => {
        store = promo({ validUntil: future(), maxUses: 2, usedCount: 1 });
        const discount = await service.consume(COMPANY, 'SALE10', 200);
        expect(discount).toBe(20);
        expect(store.usedCount).toBe(2); // ровно +1
      });
    });

    // Настоящая атомарность/изоляция конкурентных транзакций на моках
    // недостижима — это гарантия СУБД, а не JS. Нужна тестовая Postgres.
    it.todo(
      'ЖИВАЯ БД: N параллельных consume при maxUses=K → успешны РОВНО K ' +
        '(атомарность conditional UPDATE + изоляция транзакций Prisma; на моках недостижимо)',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // release() — возврат использования при откате продажи (не ниже нуля)
  // ─────────────────────────────────────────────────────────────────────────
  describe('release()', () => {
    it('декрементит usedCount и не опускает ниже нуля (where usedCount>0)', async () => {
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });
      await service.release(COMPANY, '  sale10 ');

      expect(prisma.promoCode.updateMany).toHaveBeenCalledTimes(1);
      const arg = prisma.promoCode.updateMany.mock.calls[0][0];
      expect(arg.where.companyId).toBe(COMPANY);
      expect(arg.where.code).toBe('SALE10'); // нормализован
      expect(arg.where.deletedAt).toBeNull();
      expect(arg.where.usedCount).toEqual({ gt: 0 }); // ГАРД пола: не ниже нуля
      expect(arg.data).toEqual({ usedCount: { decrement: 1 } });
    });

    it.todo(
      'ЖИВАЯ БД: параллельные release не уводят usedCount ниже нуля ' +
        '(условный decrement при usedCount>0 — гарантия СУБД, не мока)',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // create() / findAll() / remove() — CRUD и нормализация
  // ─────────────────────────────────────────────────────────────────────────
  describe('create()', () => {
    it('нормализует код (trim+upper) и подставляет дефолты', async () => {
      prisma.promoCode.create.mockResolvedValue({ id: 'x' });
      await service.create(COMPANY, { code: '  sale10 ', value: 10 } as never);

      const data = prisma.promoCode.create.mock.calls[0][0].data;
      expect(data.code).toBe('SALE10');
      expect(data.companyId).toBe(COMPANY);
      expect(data.discountType).toBe(DiscountType.PERCENT); // дефолт
      expect(data.maxUses).toBeNull(); // дефолт
      expect(data.validUntil).toBeNull(); // дефолт
      expect(data.value).toBe(10);
    });

    it('пробрасывает discountType/maxUses и парсит validUntil в Date', async () => {
      prisma.promoCode.create.mockResolvedValue({ id: 'x' });
      await service.create(COMPANY, {
        code: 'FIX',
        value: 50,
        discountType: DiscountType.FIXED,
        maxUses: 3,
        validUntil: '2030-01-01T00:00:00.000Z',
      } as never);

      const data = prisma.promoCode.create.mock.calls[0][0].data;
      expect(data.discountType).toBe(DiscountType.FIXED);
      expect(data.maxUses).toBe(3);
      expect(data.validUntil).toBeInstanceOf(Date);
      expect((data.validUntil as Date).toISOString()).toBe(
        '2030-01-01T00:00:00.000Z',
      );
    });
  });

  describe('findAll()', () => {
    it('фильтрует по компании и не показывает удалённые, сортирует по createdAt desc', async () => {
      const rows = [{ id: 'a' }];
      prisma.promoCode.findMany.mockResolvedValue(rows);
      const res = await service.findAll(COMPANY);

      expect(res).toBe(rows);
      const arg = prisma.promoCode.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ companyId: COMPANY, deletedAt: null });
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('remove()', () => {
    it('мягко удаляет (deletedAt=now) в рамках компании и возвращает {ok:true}', async () => {
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });
      const res = await service.remove(COMPANY, 'promo-1');

      expect(res).toEqual({ ok: true });
      const arg = prisma.promoCode.updateMany.mock.calls[0][0];
      expect(arg.where.id).toBe('promo-1');
      expect(arg.where.companyId).toBe(COMPANY);
      expect(arg.where.deletedAt).toBeNull(); // не трогаем уже удалённые
      expect(arg.data.deletedAt).toBeInstanceOf(Date);
    });
  });
});
