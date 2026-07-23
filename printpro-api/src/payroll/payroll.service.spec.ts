import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalaryType } from '@prisma/client';
import { PayrollService } from './payroll.service';

/**
 * Честные unit-тесты бизнес-правил модуля зарплат.
 *
 * Стратегия: поднимаем НАСТОЯЩИЙ PayrollService, подменяя только PrismaService
 * (моки таблиц) и AuditService. Проверяем реальную логику сервиса — расчёт
 * итогов за период, авансы/табель и АТОМАРНУЮ выплату (нет двойного расхода из
 * кассы при повторе/гонке, P0-10).
 *
 * Что достоверно НЕ проверяется на моках (реальный откат Prisma-транзакции,
 * DB-level сериализация конкурентных запросов, попадание пограничных строк в
 * aggregate по датам) — вынесено в it.todo ниже: этим нужна живая БД.
 */

// Свежий мок Prisma на каждый тест. $transaction прокидывает сам prisma как tx.
function createPrismaMock() {
  const prisma: any = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(async ({ data }: any) => ({ id: 'u1', ...data })),
    },
    workTimeRecord: {
      create: jest.fn(async ({ data }: any) => ({ id: 'wt-1', ...data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { hours: 0 } }),
    },
    salaryAdvance: {
      create: jest.fn(async ({ data }: any) => ({ id: 'adv-1', ...data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    payrollPeriod: {
      create: jest.fn(async ({ data }: any) => ({ id: 'per-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    salaryRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(async ({ create }: any) => create),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    cashMovement: {
      create: jest.fn(async ({ data }: any) => ({ id: 'cm-1', ...data })),
    },
    cashShift: { findFirst: jest.fn() },
  };
  // Мок транзакции: колбэк получает тот же prisma-мок как tx-клиент.
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return prisma;
}

function setup() {
  const prisma = createPrismaMock();
  const audit = { recordTx: jest.fn(), record: jest.fn() };
  const service = new PayrollService(prisma as any, audit as any);
  return { prisma, audit, service };
}

describe('PayrollService', () => {
  // ---------------------------------------------------------------------------
  // Ставки сотрудников
  // ---------------------------------------------------------------------------
  describe('setSalary', () => {
    it('обновляет ставку сотрудника СВОЕЙ компании', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({
        id: 'u1',
        fullName: 'Иван',
        position: 'Печатник',
        salaryType: SalaryType.HOURLY,
        rate: 30,
      });
      const res = await service.setSalary(
        'u1',
        { position: 'Печатник', salaryType: SalaryType.HOURLY, rate: 30 },
        'c1',
      );
      // ищем строго в рамках компании из токена
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1', companyId: 'c1' } }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { position: 'Печатник', salaryType: SalaryType.HOURLY, rate: 30 },
        }),
      );
      expect(res.rate).toBe(30);
    });

    it('чужой/несуществующий сотрудник → NotFound, update не вызывается', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.setSalary('u1', { rate: 100 }, 'c1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('staff', () => {
    it('возвращает активных сотрудников; rate приведён к number', async () => {
      const { prisma, service } = setup();
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          fullName: 'Иван',
          position: 'Печатник',
          salaryType: SalaryType.HOURLY,
          rate: '25.5', // Prisma Decimal приходит строкой/Decimal
          role: { name: 'staff' },
        },
      ]);
      const res = await service.staff('c1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'c1', isActive: true } }),
      );
      expect(res[0].rate).toBe(25.5);
      expect(typeof res[0].rate).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------
  // Рабочее время (табель)
  // ---------------------------------------------------------------------------
  describe('addWorkTime', () => {
    it('создаёт запись табеля для сотрудника компании; дата парсится', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      await service.addWorkTime({
        companyId: 'c1',
        userId: 'u1',
        hours: 8,
        note: 'смена',
        date: '2026-07-10',
      });
      // scoping по компании из токена (защита от IDOR)
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1', companyId: 'c1', deletedAt: null },
        }),
      );
      const data = prisma.workTimeRecord.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        companyId: 'c1',
        userId: 'u1',
        hours: 8,
        note: 'смена',
      });
      expect(data.date).toBeInstanceOf(Date);
    });

    it('без даты — date=undefined (БД проставит default now())', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      await service.addWorkTime({ companyId: 'c1', userId: 'u1', hours: 5 });
      expect(prisma.workTimeRecord.create.mock.calls[0][0].data.date).toBeUndefined();
    });

    it('сотрудник не из компании токена → NotFound, запись не создаётся (IDOR)', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.addWorkTime({ companyId: 'c1', userId: 'foreign', hours: 8 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.workTimeRecord.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Авансы
  // ---------------------------------------------------------------------------
  describe('addAdvance', () => {
    it('аванс из кассы (по умолчанию) → аванс + расход по открытой смене, категория «Аванс»', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      prisma.user.findUnique.mockResolvedValue({ fullName: 'Иван Петров' });
      prisma.cashShift.findFirst.mockResolvedValue({ id: 'shift-1' });
      const res = await service.addAdvance(
        { companyId: 'c1', userId: 'u1', amount: 500 },
        'cashier-1',
      );
      expect(prisma.salaryAdvance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'c1',
            userId: 'u1',
            amount: 500,
            paidFromCash: true, // дефолт
          }),
        }),
      );
      expect(prisma.cashMovement.create).toHaveBeenCalledTimes(1);
      const cm = prisma.cashMovement.create.mock.calls[0][0].data;
      expect(cm).toMatchObject({
        companyId: 'c1',
        shiftId: 'shift-1',
        type: 'OUT',
        amount: 500,
        category: 'Аванс',
      });
      // ФИО сотрудника попадает в reason движения
      expect(cm.reason).toContain('Иван Петров');
      expect(res.amount).toBe(500);
    });

    it('аванс НЕ из кассы (paidFromCash=false) → движение по кассе НЕ создаётся', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      await service.addAdvance(
        { companyId: 'c1', userId: 'u1', amount: 300, paidFromCash: false },
        'cashier-1',
      );
      expect(prisma.salaryAdvance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paidFromCash: false }),
        }),
      );
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
      expect(prisma.cashShift.findFirst).not.toHaveBeenCalled();
    });

    it('чужой сотрудник → NotFound, транзакция не стартует (IDOR + PII)', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.addAdvance(
          { companyId: 'c1', userId: 'foreign', amount: 100 },
          'cashier-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('аванс наличными без открытой смены кассира → BadRequest (не выпадет из Z-отчёта)', async () => {
      const { prisma, service } = setup();
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      prisma.user.findUnique.mockResolvedValue({ fullName: 'Иван' });
      prisma.cashShift.findFirst.mockResolvedValue(null); // открытой смены нет
      await expect(
        service.addAdvance(
          { companyId: 'c1', userId: 'u1', amount: 500 },
          'cashier-1',
        ),
      ).rejects.toThrow('Open cash shift not found');
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Периоды
  // ---------------------------------------------------------------------------
  describe('createPeriod', () => {
    it('конец периода расширяется до конца дня (23:59:59.999)', async () => {
      const { prisma, service } = setup();
      await service.createPeriod({
        companyId: 'c1',
        name: 'Июль',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      const data = prisma.payrollPeriod.create.mock.calls[0][0].data;
      const end: Date = data.endDate;
      // границу выставляют через setHours в ЛОКАЛЬНОМ времени — компоненты детерминированы
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
      expect(end.getMilliseconds()).toBe(999);
      // конец периода строго позже начала
      expect(end.getTime()).toBeGreaterThan((data.startDate as Date).getTime());
    });
  });

  describe('closePeriod', () => {
    it('закрывает период своей компании (isClosed=true)', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue({ id: 'p1', companyId: 'c1' });
      await service.closePeriod('p1', 'c1');
      expect(prisma.payrollPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' }, data: { isClosed: true } }),
      );
    });

    it('чужой/несуществующий период → NotFound', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(null);
      await expect(service.closePeriod('p1', 'c1')).rejects.toThrow(NotFoundException);
      expect(prisma.payrollPeriod.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Расчёт итогов за период
  // ---------------------------------------------------------------------------
  describe('calculate', () => {
    const period = {
      id: 'p1',
      companyId: 'c1',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-07-31T23:59:59.999Z'),
      isClosed: false,
    };

    it('MONTHLY: база=оклад; итог = база + бонус − аванс − удержание', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(period);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', companyId: 'c1', isActive: true, salaryType: SalaryType.MONTHLY, rate: 5000 },
      ]);
      // существующая запись с бонусом/удержанием — они должны сохраниться
      prisma.salaryRecord.findUnique.mockResolvedValue({
        isPaid: false,
        bonus: 200,
        deduction: 100,
      });
      prisma.salaryAdvance.aggregate.mockResolvedValue({ _sum: { amount: 700 } });
      await service.calculate('p1', 'c1');

      // MONTHLY не агрегирует часы
      expect(prisma.workTimeRecord.aggregate).not.toHaveBeenCalled();
      const create = prisma.salaryRecord.upsert.mock.calls[0][0].create;
      expect(create.base).toBe(5000);
      expect(create.advance).toBe(700);
      expect(create.bonus).toBe(200);
      expect(create.deduction).toBe(100);
      // 5000 + 200 − 700 − 100 = 4400
      expect(create.total).toBe(4400);
    });

    it('HOURLY: база = сумма часов × ставку (табель агрегируется в границах периода и компании)', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(period);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', companyId: 'c1', isActive: true, salaryType: SalaryType.HOURLY, rate: 25 },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.workTimeRecord.aggregate.mockResolvedValue({ _sum: { hours: 160 } });
      prisma.salaryAdvance.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      await service.calculate('p1', 'c1');

      expect(prisma.workTimeRecord.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'c1',
            userId: 'u1',
            date: { gte: period.startDate, lte: period.endDate },
          }),
          _sum: { hours: true },
        }),
      );
      const create = prisma.salaryRecord.upsert.mock.calls[0][0].create;
      expect(create.base).toBe(4000); // 25 × 160
      expect(create.bonus).toBe(0); // новой записи не было
      expect(create.deduction).toBe(0);
      expect(create.total).toBe(4000);
    });

    it('HOURLY без табеля: часы=0 → база=0, итог=0', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(period);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', companyId: 'c1', isActive: true, salaryType: SalaryType.HOURLY, rate: 25 },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.workTimeRecord.aggregate.mockResolvedValue({ _sum: { hours: null } }); // нет строк
      await service.calculate('p1', 'c1');
      const create = prisma.salaryRecord.upsert.mock.calls[0][0].create;
      expect(create.base).toBe(0);
      expect(create.total).toBe(0);
    });

    it('авансы больше базы → итог клампится нулём (не уходит в минус)', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(period);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', companyId: 'c1', isActive: true, salaryType: SalaryType.MONTHLY, rate: 1000 },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.salaryAdvance.aggregate.mockResolvedValue({ _sum: { amount: 5000 } });
      await service.calculate('p1', 'c1');
      expect(prisma.salaryRecord.upsert.mock.calls[0][0].create.total).toBe(0);
    });

    it('итог округляется до 2 знаков (10.1 × 3 = 30.2999… → 30.3)', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(period);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', companyId: 'c1', isActive: true, salaryType: SalaryType.HOURLY, rate: 10.1 },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.workTimeRecord.aggregate.mockResolvedValue({ _sum: { hours: 3 } });
      prisma.salaryAdvance.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      await service.calculate('p1', 'c1');
      expect(prisma.salaryRecord.upsert.mock.calls[0][0].create.total).toBe(30.3);
    });

    it('уже выплаченную запись не пересчитывает (факт выплаты не искажается)', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(period);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', companyId: 'c1', isActive: true, salaryType: SalaryType.MONTHLY, rate: 5000 },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue({ isPaid: true, bonus: 0, deduction: 0 });
      await service.calculate('p1', 'c1');
      expect(prisma.salaryRecord.upsert).not.toHaveBeenCalled();
      // до расчёта авансов даже не доходим
      expect(prisma.salaryAdvance.aggregate).not.toHaveBeenCalled();
    });

    it('несколько сотрудников: считает каждому свой итог', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(period);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', companyId: 'c1', isActive: true, salaryType: SalaryType.MONTHLY, rate: 5000 },
        { id: 'u2', companyId: 'c1', isActive: true, salaryType: SalaryType.MONTHLY, rate: 3000 },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.salaryAdvance.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      await service.calculate('p1', 'c1');
      expect(prisma.salaryRecord.upsert).toHaveBeenCalledTimes(2);
      const totals = prisma.salaryRecord.upsert.mock.calls.map((c: any) => c[0].create.total);
      expect(totals).toEqual([5000, 3000]);
    });

    it('закрытый период → BadRequest (пересчёт запрещён)', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue({ ...period, isClosed: true });
      await expect(service.calculate('p1', 'c1')).rejects.toThrow('Период закрыт');
      expect(prisma.salaryRecord.upsert).not.toHaveBeenCalled();
    });

    it('чужой/несуществующий период → NotFound', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue(null);
      await expect(service.calculate('p1', 'c1')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // Список итогов
  // ---------------------------------------------------------------------------
  describe('listRecords', () => {
    it('сортирует по итогу по убыванию; Decimal → number', async () => {
      const { prisma, service } = setup();
      prisma.payrollPeriod.findFirst.mockResolvedValue({ id: 'p1', companyId: 'c1' });
      prisma.salaryRecord.findMany.mockResolvedValue([
        {
          id: 'r1', userId: 'u1', base: 100, bonus: 0, advance: 0, deduction: 0,
          total: 100, isPaid: false, user: { fullName: 'A', position: 'p' },
        },
        {
          id: 'r2', userId: 'u2', base: 300, bonus: 0, advance: 0, deduction: 0,
          total: 300, isPaid: true, user: { fullName: 'B', position: 'p' },
        },
      ]);
      const res = await service.listRecords('p1', 'c1');
      expect(res.map((r) => r.total)).toEqual([300, 100]);
      expect(res[0].name).toBe('B');
      expect(typeof res[0].base).toBe('number');
      // фильтрация по companyId (изоляция арендаторов)
      expect(prisma.salaryRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { periodId: 'p1', companyId: 'c1' } }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Изменение бонуса/удержания
  // ---------------------------------------------------------------------------
  describe('updateRecord', () => {
    it('пересчитывает итог по новым бонусу/удержанию', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue({
        id: 'r1', base: 5000, bonus: 0, advance: 1000, deduction: 0,
        isPaid: false, period: { isClosed: false },
      });
      await service.updateRecord('r1', { bonus: 500, deduction: 200 }, 'c1');
      const data = prisma.salaryRecord.update.mock.calls[0][0].data;
      expect(data.bonus).toBe(500);
      expect(data.deduction).toBe(200);
      // 5000 + 500 − 1000 − 200 = 4300
      expect(data.total).toBe(4300);
    });

    it('пропущенные поля берутся из текущей записи', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue({
        id: 'r1', base: 2000, bonus: 300, advance: 0, deduction: 150,
        isPaid: false, period: { isClosed: false },
      });
      await service.updateRecord('r1', {}, 'c1');
      const data = prisma.salaryRecord.update.mock.calls[0][0].data;
      expect(data.bonus).toBe(300);
      expect(data.deduction).toBe(150);
      expect(data.total).toBe(2150); // 2000 + 300 − 0 − 150
    });

    it('огромное удержание → итог 0 (не отрицательный)', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue({
        id: 'r1', base: 1000, bonus: 0, advance: 0, deduction: 0,
        isPaid: false, period: { isClosed: false },
      });
      await service.updateRecord('r1', { deduction: 9999 }, 'c1');
      expect(prisma.salaryRecord.update.mock.calls[0][0].data.total).toBe(0);
    });

    it('выплаченную запись менять нельзя → BadRequest', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue({
        id: 'r1', base: 1000, bonus: 0, advance: 0, deduction: 0,
        isPaid: true, period: { isClosed: false },
      });
      await expect(
        service.updateRecord('r1', { bonus: 100 }, 'c1'),
      ).rejects.toThrow('уже выплачена');
      expect(prisma.salaryRecord.update).not.toHaveBeenCalled();
    });

    it('закрытый период → BadRequest', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue({
        id: 'r1', base: 1000, bonus: 0, advance: 0, deduction: 0,
        isPaid: false, period: { isClosed: true },
      });
      await expect(
        service.updateRecord('r1', { bonus: 100 }, 'c1'),
      ).rejects.toThrow('Период закрыт');
      expect(prisma.salaryRecord.update).not.toHaveBeenCalled();
    });

    it('запись не найдена/чужая компания → NotFound', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue(null);
      await expect(
        service.updateRecord('r1', { bonus: 100 }, 'c1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // ВЫПЛАТА — атомарность (P0-10: нет двойного расхода из кассы)
  // ---------------------------------------------------------------------------
  describe('pay', () => {
    const okRecord = {
      id: 'r1',
      companyId: 'c1',
      total: 4400,
      user: { fullName: 'Иван' },
      period: { isClosed: false },
      isPaid: false,
    };

    it('happy-path: атомарный флип (updateMany where isPaid:false) + один расход из кассы + аудит', async () => {
      const { prisma, audit, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue(okRecord);
      prisma.salaryRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.cashShift.findFirst.mockResolvedValue({ id: 'shift-1' });
      const res = await service.pay('r1', 'c1', 'cashier-1');

      expect(res).toEqual({ ok: true });
      // ключевой атомарный guard: помечаем ТОЛЬКО если ещё не выплачена
      expect(prisma.salaryRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1', companyId: 'c1', isPaid: false },
          data: { isPaid: true },
        }),
      );
      expect(prisma.cashMovement.create).toHaveBeenCalledTimes(1);
      const cm = prisma.cashMovement.create.mock.calls[0][0].data;
      expect(cm).toMatchObject({
        companyId: 'c1',
        shiftId: 'shift-1',
        type: 'OUT',
        amount: 4400,
        category: 'Зарплата',
      });
      expect(cm.reason).toContain('Иван');
      expect(audit.recordTx).toHaveBeenCalledTimes(1);
    });

    it('updateMany вернул count 0 (кто-то опередил) → BadRequest, БЕЗ расхода и аудита', async () => {
      const { prisma, audit, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue(okRecord);
      prisma.salaryRecord.updateMany.mockResolvedValue({ count: 0 }); // проиграли гонку
      prisma.cashShift.findFirst.mockResolvedValue({ id: 'shift-1' });
      await expect(service.pay('r1', 'c1', 'cashier-1')).rejects.toThrow('Уже выплачено');
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
      expect(audit.recordTx).not.toHaveBeenCalled();
    });

    it('ГОНКА: два параллельных pay на одну запись → ровно ОДНА выплата, один расход из кассы (P0-10)', async () => {
      const { prisma, audit, service } = setup();
      // Оба запроса проходят УСТАРЕВШУЮ проверку rec.isPaid=false — суть гонки.
      prisma.salaryRecord.findFirst.mockResolvedValue(okRecord);
      prisma.cashShift.findFirst.mockResolvedValue({ id: 'shift-1' });
      // Атомарный флип: состояние в моке, проверка+запись без await между ними,
      // поэтому в event loop это неделимо — count:1 получит только первый.
      let paid = false;
      prisma.salaryRecord.updateMany.mockImplementation(async ({ where }: any) => {
        if (where.isPaid === false && !paid) {
          paid = true;
          return { count: 1 };
        }
        return { count: 0 };
      });

      const results = await Promise.allSettled([
        service.pay('r1', 'c1', 'cashier-1'),
        service.pay('r1', 'c1', 'cashier-1'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // самое важное: деньги вышли из кассы РОВНО один раз
      expect(prisma.cashMovement.create).toHaveBeenCalledTimes(1);
      expect(audit.recordTx).toHaveBeenCalledTimes(1);
    });

    it('повторная выплата уже выплаченной записи → BadRequest на пред-проверке (идемпотентный ретрай)', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue({ ...okRecord, isPaid: true });
      await expect(service.pay('r1', 'c1', 'cashier-1')).rejects.toThrow('Уже выплачено');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });

    it('закрытый период → BadRequest, транзакция не стартует', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue({
        ...okRecord,
        period: { isClosed: true },
      });
      await expect(service.pay('r1', 'c1', 'cashier-1')).rejects.toThrow('Период закрыт');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('запись не найдена/чужая компания → NotFound', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue(null);
      await expect(service.pay('r1', 'c1', 'cashier-1')).rejects.toThrow(NotFoundException);
    });

    it('нет открытой смены у кассира → BadRequest ДО создания расхода из кассы', async () => {
      const { prisma, service } = setup();
      prisma.salaryRecord.findFirst.mockResolvedValue(okRecord);
      prisma.salaryRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.cashShift.findFirst.mockResolvedValue(null); // смены нет
      await expect(service.pay('r1', 'c1', 'cashier-1')).rejects.toThrow(
        'Open cash shift not found',
      );
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Требуют ЖИВОЙ БД (реальная транзакция / изоляция) — не проверяемо на моках.
  // ---------------------------------------------------------------------------
  describe('нужна живая БД (integration)', () => {
    // $transaction в моках не откатывает состояние. Нужно на реальной Prisma-
    // транзакции убедиться, что при падении cashMovement/аудита ПОСЛЕ флипа
    // isPaid=true запись возвращается в isPaid=false (нет «выплачено без денег»).
    it.todo(
      'pay: реальный откат Prisma-транзакции при ошибке после атомарного флипа возвращает isPaid=false',
    );
    // Настоящую сериализацию двух конкурентных транзакций на одной строке
    // (row lock / уникальный индекс) даёт только реальная БД; мок эмулирует
    // лишь app-level guard по count.
    it.todo(
      'pay: две реально конкурентные транзакции БД сериализуются на строке (один cashMovement)',
    );
    // Реальную фильтрацию по границам периода (запись за последний день 23:59
    // попадает в aggregate, а за следующий день — нет) проверяет только БД.
    it.todo(
      'calculate: aggregate табеля/авансов включает записи последнего дня периода и исключает следующего',
    );
  });
});
