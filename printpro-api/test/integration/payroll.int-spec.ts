import { SalaryType } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { PayrollService } from '../../src/payroll/payroll.service';
import { makePrisma, truncateAll } from './_db';

/**
 * Интеграционные тесты payroll на ЖИВОМ Postgres (отдельная тестовая БД).
 *
 * Здесь проверяются гарантии УРОВНЯ БД, которые НЕ доказать на моках Prisma:
 *  1) реальная сериализация двух конкурентных pay() на одной строке —
 *     ровно одна выплата и один расход из кассы (нет двойной, P0-10);
 *  2) реальный ОТКАТ Prisma-транзакции: сбой ПОСЛЕ атомарного флипа isPaid
 *     возвращает запись в isPaid=false (нет «выплачено без денег/следа»);
 *  3) включение/исключение пограничных строк табеля по датам периода
 *     (последний момент 23:59:59.999 включён, следующий — нет).
 *
 * Сервис поднимается НАСТОЯЩИЙ: реальный PrismaService (тестовая БД) и реальный
 * AuditService(prisma). Внешних I/O у PayrollService нет — конструктор (prisma,
 * audit), см. src/payroll/payroll.service.spec.ts.
 */
describe('Интеграция (живой Postgres): payroll — гарантии уровня БД', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  let service: PayrollService;

  beforeAll(async () => {
    prisma = makePrisma();
    await prisma.$connect();
    audit = new AuditService(prisma);
    service = new PayrollService(prisma, audit);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(() => {
    // снять возможные spy (см. тест отката), чтобы не текли между тестами
    jest.restoreAllMocks();
  });

  // --- сид: компания + сотрудник (он же кассир) + ОТКРЫТАЯ смена ---------------
  async function seedCompanyUserShift() {
    const company = await prisma.company.create({ data: { name: 'ACME' } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        login: 'cashier',
        passwordHash: 'x',
        fullName: 'Иван Кассир',
      },
    });
    // Открытая смена: closedAt=null, deletedAt=null — нужна для расхода из кассы.
    const shift = await prisma.cashShift.create({
      data: { companyId: company.id, userId: user.id },
    });
    return { company, user, shift };
  }

  // --- сид: период + невыплаченная запись зарплаты ----------------------------
  async function seedPayableRecord(
    companyId: string,
    userId: string,
    total = 1000,
  ) {
    const period = await prisma.payrollPeriod.create({
      data: {
        companyId,
        name: 'Июль 2026',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-07-31T23:59:59.999Z'),
      },
    });
    const record = await prisma.salaryRecord.create({
      data: {
        companyId,
        periodId: period.id,
        userId,
        base: total,
        total,
        isPaid: false,
      },
    });
    return { period, record };
  }

  // ===========================================================================
  // Happy-path: реальная транзакция КОММИТИТСЯ целиком (опора для теста отката).
  // ===========================================================================
  it('pay(): успешная выплата фиксирует в БД isPaid=true + один расход кассы + одну запись аудита', async () => {
    const { company, user } = await seedCompanyUserShift();
    const { record } = await seedPayableRecord(company.id, user.id, 1500);

    const res = await service.pay(record.id, company.id, user.id);
    expect(res).toEqual({ ok: true });

    const rec = await prisma.salaryRecord.findUnique({
      where: { id: record.id },
    });
    expect(rec?.isPaid).toBe(true);

    const movements = await prisma.cashMovement.findMany({
      where: { companyId: company.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('OUT');
    expect(movements[0].category).toBe('Зарплата');
    expect(Number(movements[0].amount)).toBe(1500);

    const audits = await prisma.auditLog.count({
      where: {
        entity: 'salaryRecord',
        entityId: record.id,
        action: 'money:payroll-payout',
      },
    });
    expect(audits).toBe(1);
  });

  // ===========================================================================
  // (1) ГОНКА: две конкурентные pay() одной записи → ровно ОДНА выплата и ОДИН
  // расход из кассы. Сериализацию даёт САМА БД (row-lock + перепроверка WHERE
  // isPaid=false после коммита соперника), а не app-level счётчик на моках.
  // ===========================================================================
  it('две конкурентные pay() одной записи → ровно ОДНА выплата и ОДИН расход кассы (нет двойной, P0-10)', async () => {
    const { company, user } = await seedCompanyUserShift();
    const { record } = await seedPayableRecord(company.id, user.id, 1200);

    // Два РЕАЛЬНО одновременных вызова на одну и ту же строку.
    const results = await Promise.allSettled([
      service.pay(record.id, company.id, user.id),
      service.pay(record.id, company.id, user.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // Ровно один прошёл, ровно один отклонён — независимо от того, проиграл ли
    // соперник на пред-проверке или на атомарном флипе внутри транзакции.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason?.message).toMatch(
      /выплачено/i,
    );

    // Инвариант проверяем ЗАПРОСОМ В БД, а не по возвращённым значениям.
    const rec = await prisma.salaryRecord.findUnique({
      where: { id: record.id },
    });
    expect(rec?.isPaid).toBe(true);

    // Деньги вышли из кассы РОВНО один раз.
    const movements = await prisma.cashMovement.count({
      where: { companyId: company.id, category: 'Зарплата' },
    });
    expect(movements).toBe(1);

    // И след в аудите — ровно один.
    const audits = await prisma.auditLog.count({
      where: { entityId: record.id, action: 'money:payroll-payout' },
    });
    expect(audits).toBe(1);
  });

  // ===========================================================================
  // (2) ОТКАТ: если шаг ПОСЛЕ атомарного флипа isPaid=true падает, реальная
  // Prisma-транзакция откатывается ЦЕЛИКОМ — в БД запись остаётся isPaid=false,
  // расход из кассы и запись аудита не появляются («нет выплаты без денег»).
  // Роняем последний шаг транзакции — audit.recordTx (заглушка с throw).
  // ===========================================================================
  it('ОТКАТ: сбой после флипа isPaid → в БД запись остаётся isPaid=false, расход и аудит не записаны', async () => {
    const { company, user } = await seedCompanyUserShift();
    const { record } = await seedPayableRecord(company.id, user.id, 800);

    // Аудит внутри транзакции падает уже ПОСЛЕ updateMany(isPaid=true).
    jest
      .spyOn(audit, 'recordTx')
      .mockRejectedValueOnce(new Error('boom: audit tx failed'));

    await expect(
      service.pay(record.id, company.id, user.id),
    ).rejects.toThrow('boom');

    // Транзакция откатилась целиком: атомарный флип отменён.
    const rec = await prisma.salaryRecord.findUnique({
      where: { id: record.id },
    });
    expect(rec?.isPaid).toBe(false);

    // Никаких побочных мутаций: ни движения кассы, ни записи аудита.
    const movements = await prisma.cashMovement.count({
      where: { companyId: company.id },
    });
    expect(movements).toBe(0);
    const audits = await prisma.auditLog.count({
      where: { entityId: record.id },
    });
    expect(audits).toBe(0);

    // Запись по-прежнему выплачиваема: после снятия сбоя pay() проходит.
    const ok = await service.pay(record.id, company.id, user.id);
    expect(ok).toEqual({ ok: true });
    const after = await prisma.salaryRecord.findUnique({
      where: { id: record.id },
    });
    expect(after?.isPaid).toBe(true);
  });

  // ===========================================================================
  // (3) ГРАНИЦЫ ДАТ: aggregate табеля в calculate() включает запись на самом
  // конце периода (23:59:59.999, lte inclusive) и исключает следующий момент.
  // Это фильтрация на уровне БД по timestamp — моки её не воспроизводят.
  // ===========================================================================
  it('calculate(): табель на границе конца периода (23:59:59.999) учитывается, следующий момент — нет', async () => {
    const company = await prisma.company.create({ data: { name: 'ACME-2' } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        login: 'emp',
        passwordHash: 'x',
        fullName: 'Почасовик',
        salaryType: SalaryType.HOURLY,
        rate: 10,
      },
    });

    // Период через сервис: конец расширяется до 23:59:59.999 последнего дня.
    const period = await service.createPeriod({
      companyId: company.id,
      name: 'Июль 2026',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });
    const end = period.endDate; // Date: конец последнего дня периода

    // Явно внутри периода.
    await prisma.workTimeRecord.create({
      data: {
        companyId: company.id,
        userId: user.id,
        hours: 2,
        date: new Date('2026-07-15T12:00:00.000Z'),
      },
    });
    // РОВНО на верхней границе периода → ВКЛЮЧАЕТСЯ (lte inclusive).
    await prisma.workTimeRecord.create({
      data: {
        companyId: company.id,
        userId: user.id,
        hours: 8,
        date: new Date(end),
      },
    });
    // На 1 мс позже границы → ИСКЛЮЧАЕТСЯ.
    await prisma.workTimeRecord.create({
      data: {
        companyId: company.id,
        userId: user.id,
        hours: 5,
        date: new Date(end.getTime() + 1),
      },
    });

    await service.calculate(period.id, company.id);

    const rec = await prisma.salaryRecord.findUnique({
      where: { periodId_userId: { periodId: period.id, userId: user.id } },
    });
    // База = ставка(10) × (2 + 8) = 100; строка на +1 мс не учтена (иначе было бы 130).
    expect(Number(rec?.base)).toBe(100);
    expect(Number(rec?.total)).toBe(100);
  });
});
