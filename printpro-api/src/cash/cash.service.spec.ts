import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashService } from './cash.service';
import { AuditService } from '../audit/audit.service';

/**
 * Честные unit-тесты бизнес-правил кассы (смены / Z-отчёт / движения / инкассация).
 *
 * Стратегия: поднимаем НАСТОЯЩИЙ CashService, подменяя только PrismaService
 * ФЕЙКОМ-В-ПАМЯТИ, который ЧЕСТНО повторяет поведение Prisma по тем `where`,
 * что реально выдаёт сервис: изоляция по companyId/userId, «одна открытая смена»
 * (closedAt: null), и — ключевое для денег — исключение мягко удалённых строк
 * (deletedAt: null) в include Z-отчёта. Если сервис забудет фильтр или companyId,
 * фейк вернёт лишнее и суммы «поедут» → тест покраснеет. AuditService берём
 * настоящий: он пишет в тот же фейк внутри транзакции, так что мы заодно проверяем
 * «нет движения денег без следа».
 *
 * $transaction(fn) прокидывает сам фейк как tx — сервис работает с одним стором.
 * updateMany атомарен на уровне event-loop (нет await между чтением и записью),
 * поэтому app-level guard «одна выигрывает гонку» воспроизводим и на моках.
 *
 * Гарантии, которым нужна ЖИВАЯ БД (реальный partial-unique-индекс, откат
 * Prisma-транзакции, сериализация конкурентных транзакций на строке, TOCTOU в
 * одной транзакции) — вынесены в it.todo и в todosNeedingDb.
 */

const COMPANY = 'company-1';
const OTHER_COMPANY = 'company-2';
const USER = 'cashier-1';
const OTHER_USER = 'cashier-2';
const BRANCH = 'branch-1';

const dec = (n: number) => new Prisma.Decimal(n);

let idSeq = 0;
const nextId = (p: string) => `${p}-${++idSeq}`;

// Строка оплаты, как её вернёт Prisma-include (amount — Decimal, как из БД).
function pay(o: {
  method: 'CASH' | 'CARD' | 'QR' | 'TRANSFER' | 'DEBT';
  amount: Prisma.Decimal;
  deletedAt?: Date | null;
  orderNumber?: string | null;
}) {
  return {
    id: nextId('pay'),
    amount: o.amount,
    method: o.method,
    createdAt: new Date('2026-07-23T10:00:00.000Z'),
    deletedAt: o.deletedAt ?? null,
    order: o.orderNumber ? { orderNumber: o.orderNumber } : null,
  };
}

// Кассовое движение (внесение/изъятие/инкассация).
function mov(o: {
  type: 'IN' | 'OUT';
  amount: Prisma.Decimal;
  category?: string | null;
  reason?: string | null;
  deletedAt?: Date | null;
}) {
  return {
    id: nextId('mov'),
    type: o.type,
    amount: o.amount,
    category: o.category ?? null,
    reason: o.reason ?? null,
    createdAt: new Date('2026-07-23T10:00:00.000Z'),
    deletedAt: o.deletedAt ?? null,
  };
}

// Универсальный матчер where: null → «поле IS NULL», иначе строгое равенство.
// Так фейк повторяет фильтрацию Prisma (companyId/userId/closedAt/deletedAt),
// включая исключение мягко удалённых строк.
function applyWhere(row: any, where: any): boolean {
  for (const [key, val] of Object.entries(where ?? {})) {
    if (val === null) {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (typeof val === 'object') {
      // вложенных объектных условий модуль cash не использует
      return false;
    } else if (row[key] !== val) {
      return false;
    }
  }
  return true;
}

// Проекция строки смены под include/select, которые запрашивает сервис.
function projectShift(s: any, opts: { include?: any; select?: any }): any {
  const { include, select } = opts ?? {};
  if (select) {
    const out: any = {};
    for (const k of Object.keys(select)) if (select[k]) out[k] = s[k];
    return out;
  }
  const base: any = {
    id: s.id,
    companyId: s.companyId,
    userId: s.userId,
    number: s.number,
    branchId: s.branchId,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    openingBalance: s.openingBalance,
    closingBalance: s.closingBalance,
    deletedAt: s.deletedAt,
  };
  if (!include) return base;
  const out: any = { ...base };
  if (include.user) {
    out.user = s.user ? { id: s.user.id, fullName: s.user.fullName } : null;
  }
  if (include.branch) {
    out.branch = s.branch ? { id: s.branch.id, name: s.branch.name } : null;
  }
  if (include.payments) {
    const w = include.payments.where ?? {};
    out.payments = (s.payments ?? [])
      .filter((p: any) => applyWhere(p, w))
      .map((p: any) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        createdAt: p.createdAt,
        order: p.order ?? null,
      }));
  }
  if (include.movements) {
    const w = include.movements.where ?? {};
    out.movements = (s.movements ?? [])
      .filter((m: any) => applyWhere(m, w))
      .map((m: any) => ({
        id: m.id,
        type: m.type,
        amount: m.amount,
        category: m.category ?? null,
        reason: m.reason ?? null,
        createdAt: m.createdAt,
      }));
  }
  return out;
}

function makeStore() {
  return {
    shifts: [] as any[],
    branches: [] as any[],
    audit: [] as any[],
    seq: 0,
    idc: 0,
  };
}

// Засеять готовую смену прямо в стор (как будто уже в БД).
function seedShift(
  store: any,
  o: {
    id?: string;
    companyId?: string;
    userId?: string;
    userName?: string;
    number?: string;
    branchId?: string | null;
    branchName?: string | null;
    openedAt?: Date;
    closedAt?: Date | null;
    openingBalance?: Prisma.Decimal;
    closingBalance?: Prisma.Decimal | null;
    deletedAt?: Date | null;
    payments?: any[];
    movements?: any[];
  } = {},
) {
  const userId = o.userId ?? USER;
  const s = {
    id: o.id ?? nextId('shift'),
    companyId: o.companyId ?? COMPANY,
    userId,
    number: o.number ?? 'SMENA-C-2026-0001',
    branchId: o.branchId ?? null,
    branch: o.branchId
      ? { id: o.branchId, name: o.branchName ?? 'Центр' }
      : null,
    user: { id: userId, fullName: o.userName ?? 'Кассир Пётр' },
    openedAt: o.openedAt ?? new Date('2026-07-23T08:00:00.000Z'),
    closedAt: o.closedAt ?? null,
    openingBalance: o.openingBalance ?? dec(0),
    closingBalance: o.closingBalance ?? null,
    deletedAt: o.deletedAt ?? null,
    payments: o.payments ?? [],
    movements: o.movements ?? [],
  };
  store.shifts.push(s);
  return s;
}

// Фейк PrismaService: честно повторяет запросы, которые выдаёт CashService.
function makeFakePrisma(store: any) {
  const prisma: any = {
    cashShift: {
      findFirst: jest.fn(
        async ({ where, include, select, orderBy }: any = {}) => {
          let rows = store.shifts.filter((s: any) => applyWhere(s, where));
          if (orderBy?.openedAt === 'desc') {
            rows = [...rows].sort(
              (a, b) => +new Date(b.openedAt) - +new Date(a.openedAt),
            );
          }
          const s = rows[0];
          return s ? projectShift(s, { include, select }) : null;
        },
      ),
      findMany: jest.fn(async ({ where, include, orderBy, take }: any = {}) => {
        let rows = store.shifts.filter((s: any) => applyWhere(s, where));
        if (orderBy?.openedAt === 'desc') {
          rows = [...rows].sort(
            (a, b) => +new Date(b.openedAt) - +new Date(a.openedAt),
          );
        }
        if (take) rows = rows.slice(0, take);
        return rows.map((s: any) => projectShift(s, { include }));
      }),
      create: jest.fn(async ({ data }: any) => {
        const s = {
          id: data.id ?? nextId('shift'),
          companyId: data.companyId,
          userId: data.userId,
          number: data.number ?? null,
          branchId: data.branchId ?? null,
          branch: store.branches.find((b: any) => b.id === data.branchId) ?? null,
          user: { id: data.userId, fullName: 'Кассир Пётр' },
          openedAt: new Date(),
          closedAt: null,
          openingBalance: data.openingBalance ?? dec(0),
          closingBalance: null,
          deletedAt: null,
          payments: [],
          movements: [],
        };
        store.shifts.push(s);
        return projectShift(s, {});
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        // Атомарно: фильтр + запись без внутреннего await — неделимо в event-loop.
        const rows = store.shifts.filter((s: any) => applyWhere(s, where));
        for (const s of rows) Object.assign(s, data);
        return { count: rows.length };
      }),
    },
    cashMovement: {
      create: jest.fn(async ({ data }: any) => {
        const m = {
          id: nextId('mov-db'),
          companyId: data.companyId,
          shiftId: data.shiftId,
          type: data.type,
          amount: data.amount,
          category: data.category ?? null,
          reason: data.reason ?? null,
          createdAt: new Date(),
          deletedAt: null,
        };
        const shift = store.shifts.find((s: any) => s.id === data.shiftId);
        if (shift) shift.movements.push(m);
        return m;
      }),
    },
    branch: {
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const b = store.branches.find((x: any) => applyWhere(x, where));
        return b ? { id: b.id } : null;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        store.audit.push(data);
        return { id: nextId('audit'), ...data };
      }),
    },
    // nextSeq(): один SQL-инкремент счётчика документов.
    $queryRaw: jest.fn(async () => [{ value: ++store.seq }]),
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') return arg(prisma);
      throw new Error('unexpected $transaction(array) in cash tests');
    }),
  };
  return prisma;
}

function setup() {
  const store = makeStore();
  const prisma = makeFakePrisma(store);
  const audit = new AuditService(prisma as any);
  const service = new CashService(prisma as any, audit);
  return { store, prisma, audit, service };
}

const P2002 = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate open shift', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { target: ['companyId', 'userId'] },
  });

describe('CashService — касса/смены/Z-отчёт', () => {
  // ─────────────────────────── ОТКРЫТИЕ СМЕНЫ ───────────────────────────
  describe('openShift — одна открытая смена на кассира', () => {
    it('happy: открывает смену, присваивает номер и пишет аудит открытия', async () => {
      const { store, prisma, service } = setup();
      store.branches.push({ id: BRANCH, companyId: COMPANY, deletedAt: null });

      const res: any = await service.openShift(COMPANY, USER, {
        branchId: BRANCH,
        openingBalance: 250,
      });

      expect(res.number).toMatch(/^SMENA-.+-\d{4}$/);
      expect(Number(res.openingBalance)).toBe(250);
      expect(res.branchId).toBe(BRANCH);
      expect(store.shifts).toHaveLength(1);
      expect(prisma.cashShift.create).toHaveBeenCalledTimes(1);

      const a = store.audit.find((x: any) => x.action === 'money:shift-open');
      expect(a).toBeTruthy();
      expect(a.entity).toBe('cashShift');
      expect(a.data.after.openingBalance).toBe(250);
    });

    it('без openingBalance → стартовый остаток 0; филиал не проверяется', async () => {
      const { prisma, service } = setup();
      const res: any = await service.openShift(COMPANY, USER, {});
      expect(Number(res.openingBalance)).toBe(0);
      // без branchId assertBranch выходит сразу — лишнего запроса нет
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });

    it('передан несуществующий филиал → NotFound, смена не создаётся', async () => {
      const { store, prisma, service } = setup();
      await expect(
        service.openShift(COMPANY, USER, { branchId: 'nope' }),
      ).rejects.toThrow('Branch not found');
      expect(store.shifts).toHaveLength(0);
      expect(prisma.cashShift.create).not.toHaveBeenCalled();
    });

    it('у кассира уже есть открытая смена (пред-проверка) → BadRequest, вторую не создаём', async () => {
      const { store, prisma, service } = setup();
      seedShift(store, { userId: USER, closedAt: null });
      await expect(service.openShift(COMPANY, USER, {})).rejects.toThrow(
        'уже есть открытая смена',
      );
      expect(prisma.cashShift.create).not.toHaveBeenCalled();
      expect(store.shifts).toHaveLength(1);
    });

    it('ГОНКА: пред-проверка пуста, но create падает на unique-индексе (P2002) → BadRequest', async () => {
      const { prisma, service } = setup();
      // Постоянная (не once) заглушка: обе проверки ниже делают отдельный вызов.
      prisma.cashShift.create.mockRejectedValue(P2002());
      await expect(service.openShift(COMPANY, USER, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.openShift(COMPANY, USER, {})).rejects.toThrow(
        'уже есть открытая смена',
      );
    });

    it('прочая ошибка БД (не P2002) НЕ маскируется под «уже открыта» — пробрасывается как есть', async () => {
      const { service, prisma } = setup();
      prisma.cashShift.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('fk violation', {
          code: 'P2003',
          clientVersion: '6.19.3',
        }),
      );
      await expect(service.openShift(COMPANY, USER, {})).rejects.toMatchObject({
        code: 'P2003',
      });
    });
  });

  // ─────────────────────────── ЗАКРЫТИЕ СМЕНЫ + Z-ОТЧЁТ ───────────────────────────
  describe('closeShift — закрытие и Z-отчёт', () => {
    function seedWorkingShift(store: any) {
      // старт 100 + наличные 50 + внесение 20 − изъятие 5 → ожидаемая касса 165
      return seedShift(store, {
        userId: USER,
        closedAt: null,
        openingBalance: dec(100),
        payments: [pay({ method: 'CASH', amount: dec(50) })],
        movements: [
          mov({ type: 'IN', amount: dec(20) }),
          mov({ type: 'OUT', amount: dec(5) }),
        ],
      });
    }

    it('с фактически пересчитанной суммой: closingBalance=факт, но expectedCash считается независимо (видна недостача)', async () => {
      const { store, prisma, service } = setup();
      const shift = seedWorkingShift(store);

      const rep: any = await service.closeShift(COMPANY, USER, shift.id, {
        countedBalance: 160, // в кассе на 5 меньше расчётного
      });

      expect(rep.isOpen).toBe(false);
      expect(rep.summary.closingBalance).toBe(160);
      expect(rep.summary.expectedCash).toBe(165); // расчёт не подгоняется под факт
      expect(prisma.cashShift.updateMany).toHaveBeenCalledTimes(1);
      expect(store.shifts[0].closedAt).toBeInstanceOf(Date);

      const a = store.audit.find((x: any) => x.action === 'money:shift-close');
      expect(a).toBeTruthy();
      expect(a.data.after.countedBalance).toBe(160);
      expect(a.data.after.expectedCash).toBe(165);
    });

    it('без countedBalance → closingBalance = расчётной ожидаемой кассе (expectedCash)', async () => {
      const { service, store } = setup();
      const shift = seedWorkingShift(store);
      const rep: any = await service.closeShift(COMPANY, USER, shift.id, {});
      expect(rep.summary.closingBalance).toBe(165);
      expect(rep.summary.expectedCash).toBe(165);
    });

    it('несуществующая смена → NotFound, ничего не закрываем', async () => {
      const { service, prisma } = setup();
      await expect(
        service.closeShift(COMPANY, USER, 'missing', {}),
      ).rejects.toThrow('Смена не найдена');
      expect(prisma.cashShift.updateMany).not.toHaveBeenCalled();
    });

    it('чужая смена (другой кассир) → NotFound (владение сменой)', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, { userId: OTHER_USER, closedAt: null });
      await expect(
        service.closeShift(COMPANY, USER, shift.id, {}),
      ).rejects.toThrow('Смена не найдена');
      expect(prisma.cashShift.updateMany).not.toHaveBeenCalled();
    });

    it('смена уже закрыта (пред-проверка) → BadRequest', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        closedAt: new Date(),
        closingBalance: dec(100),
      });
      await expect(
        service.closeShift(COMPANY, USER, shift.id, {}),
      ).rejects.toThrow('Смена уже закрыта');
      expect(prisma.cashShift.updateMany).not.toHaveBeenCalled();
    });

    it('гонка: updateMany вернул count 0 (закрыли параллельно) → BadRequest, без Z-аудита', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, { userId: USER, closedAt: null });
      prisma.cashShift.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.closeShift(COMPANY, USER, shift.id, {}),
      ).rejects.toThrow('Смена уже закрыта');
      expect(
        store.audit.find((x: any) => x.action === 'money:shift-close'),
      ).toBeFalsy();
    });

    it('ДВА параллельных закрытия одной смены → ровно ОДНО успешно, один Z-аудит', async () => {
      const { store, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        closedAt: null,
        openingBalance: dec(0),
        payments: [pay({ method: 'CASH', amount: dec(10) })],
      });

      const results = await Promise.allSettled([
        service.closeShift(COMPANY, USER, shift.id, {}),
        service.closeShift(COMPANY, USER, shift.id, {}),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(
        store.audit.filter((x: any) => x.action === 'money:shift-close'),
      ).toHaveLength(1);
    });
  });

  // ─────────────────────────── Z-ОТЧЁТ: МАТЕМАТИКА ДЕНЕГ ───────────────────────────
  describe('report (Z-отчёт) — суммы по способам, долг, остаток наличных', () => {
    it('раскладывает оплаты по способам; наличная касса = старт + CASH + внесения − изъятия', async () => {
      const { store, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        openingBalance: dec(100),
        payments: [
          pay({ method: 'CASH', amount: dec(200) }),
          pay({ method: 'CARD', amount: dec(50) }),
          pay({ method: 'QR', amount: dec(30) }),
          pay({ method: 'TRANSFER', amount: dec(20) }),
        ],
        movements: [
          mov({ type: 'IN', amount: dec(40) }),
          mov({ type: 'OUT', amount: dec(10) }),
        ],
      });

      const rep: any = await service.report(shift.id, COMPANY);

      expect(rep.isOpen).toBe(true);
      expect(rep.summary).toMatchObject({
        openingBalance: 100,
        cash: 200,
        card: 50,
        qr: 30,
        transfer: 20,
        debt: 0,
        movementsIn: 40,
        movementsOut: 10,
        totalRevenue: 300, // 200+50+30+20 — деньгами
        expectedCash: 330, // 100 + 200 + 40 − 10
        paymentsCount: 4,
      });
    });

    it('ДОЛГ: строка «в долг» = сумма долговых Payment; в выручку и наличные долг НЕ входит', async () => {
      const { store, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        openingBalance: dec(0),
        payments: [
          pay({ method: 'CASH', amount: dec(100) }),
          pay({ method: 'CARD', amount: dec(50) }),
          pay({ method: 'DEBT', amount: dec(200) }),
        ],
      });

      const rep: any = await service.report(shift.id, COMPANY);

      expect(rep.summary.debt).toBe(200);
      expect(rep.summary.totalRevenue).toBe(150); // 100+50, без долга
      expect(rep.summary.expectedCash).toBe(100); // только наличные, без долга
      expect(rep.summary.cash).toBe(100);
    });

    it('мягко удалённые Payment НЕ искажают суммы (и сервис явно требует deletedAt: null)', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        openingBalance: dec(0),
        payments: [
          pay({ method: 'CASH', amount: dec(100) }),
          pay({ method: 'CASH', amount: dec(999), deletedAt: new Date() }), // сторно
          pay({ method: 'DEBT', amount: dec(500), deletedAt: new Date() }), // сторно
        ],
      });

      const rep: any = await service.report(shift.id, COMPANY);

      expect(rep.summary.cash).toBe(100); // не 1099
      expect(rep.summary.debt).toBe(0); // удалённый долг не учитываем
      expect(rep.summary.paymentsCount).toBe(1);

      // сервис ОБЯЗАН просить БД отфильтровать удалённые — иначе на живой базе поедет
      const call = prisma.cashShift.findFirst.mock.calls.find(
        (c: any) => c[0]?.include?.payments,
      );
      expect(call[0].include.payments.where).toEqual({ deletedAt: null });
      expect(call[0].include.movements.where).toEqual({ deletedAt: null });
    });

    it('мягко удалённое CashMovement НЕ искажает остаток наличных', async () => {
      const { store, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        openingBalance: dec(50),
        movements: [
          mov({ type: 'IN', amount: dec(100) }),
          mov({ type: 'OUT', amount: dec(30), deletedAt: new Date() }), // отменённое изъятие
          mov({ type: 'IN', amount: dec(20) }),
        ],
      });

      const rep: any = await service.report(shift.id, COMPANY);

      expect(rep.summary.movementsIn).toBe(120);
      expect(rep.summary.movementsOut).toBe(0); // удалённое изъятие не считается
      expect(rep.summary.expectedCash).toBe(170); // 50 + 0(cash) + 120 − 0
    });

    it('копеечные суммы округляются до 2 знаков (0.1 + 0.2 = 0.3, не 0.30000…4)', async () => {
      const { store, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        openingBalance: dec(0),
        payments: [
          pay({ method: 'CASH', amount: dec(0.1) }),
          pay({ method: 'CASH', amount: dec(0.2) }),
        ],
      });
      const rep: any = await service.report(shift.id, COMPANY);
      expect(rep.summary.cash).toBe(0.3);
      expect(rep.summary.expectedCash).toBe(0.3);
    });

    it('несуществующая смена → NotFound', async () => {
      const { service } = setup();
      await expect(service.report('missing', COMPANY)).rejects.toThrow(
        'Смена не найдена',
      );
    });

    it('отчёт чужой компании по чужой смене → NotFound (изоляция арендаторов)', async () => {
      const { store, service } = setup();
      const shift = seedShift(store, { companyId: COMPANY, userId: USER });
      await expect(service.report(shift.id, OTHER_COMPANY)).rejects.toThrow(
        'Смена не найдена',
      );
    });
  });

  // ─────────────────────────── КАССОВЫЕ ДВИЖЕНИЯ / ИНКАССАЦИЯ ───────────────────────────
  describe('addMovement — движения только по ОТКРЫТОЙ смене', () => {
    it('ИНКАССАЦИЯ: изъятие (OUT) по текущей открытой смене уменьшает ожидаемую наличность', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        closedAt: null,
        openingBalance: dec(500),
        payments: [pay({ method: 'CASH', amount: dec(300) })], // касса до инкассации = 800
      });

      const rep: any = await service.addMovement(COMPANY, USER, {
        type: 'OUT',
        amount: 700,
        category: 'инкассация',
        reason: 'Сдача в банк',
      });

      expect(prisma.cashMovement.create).toHaveBeenCalledTimes(1);
      const mvData = prisma.cashMovement.create.mock.calls[0][0].data;
      expect(mvData).toMatchObject({
        companyId: COMPANY,
        shiftId: shift.id, // легло на ОТКРЫТУЮ смену кассира
        type: 'OUT',
        amount: 700,
        category: 'инкассация',
      });
      expect(rep.summary.movementsOut).toBe(700);
      expect(rep.summary.expectedCash).toBe(100); // 500 + 300 − 700

      expect(
        store.audit.find((x: any) => x.action === 'money:cash-movement'),
      ).toBeTruthy();
    });

    it('внесение (IN) с явным shiftId СВОЕЙ открытой смены увеличивает остаток', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        closedAt: null,
        openingBalance: dec(0),
      });
      const rep: any = await service.addMovement(COMPANY, USER, {
        type: 'IN',
        amount: 200,
        shiftId: shift.id,
      });
      expect(prisma.cashMovement.create.mock.calls[0][0].data.shiftId).toBe(
        shift.id,
      );
      expect(rep.summary.movementsIn).toBe(200);
      expect(rep.summary.expectedCash).toBe(200);
    });

    it('нет shiftId и нет открытой смены → BadRequest, движение не создаётся', async () => {
      const { prisma, service } = setup();
      await expect(
        service.addMovement(COMPANY, USER, { type: 'IN', amount: 100 }),
      ).rejects.toThrow('Нет открытой смены');
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });

    it('явный shiftId указывает на ЗАКРЫТУЮ смену → NotFound, движение не создаётся', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, { userId: USER, closedAt: new Date() });
      await expect(
        service.addMovement(COMPANY, USER, {
          type: 'IN',
          amount: 100,
          shiftId: shift.id,
        }),
      ).rejects.toThrow('Open shift not found');
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });

    it('явный shiftId указывает на ЧУЖУЮ открытую смену → NotFound (нельзя двигать чужую кассу)', async () => {
      const { store, prisma, service } = setup();
      const shift = seedShift(store, { userId: OTHER_USER, closedAt: null });
      await expect(
        service.addMovement(COMPANY, USER, {
          type: 'OUT',
          amount: 50,
          shiftId: shift.id,
        }),
      ).rejects.toThrow('Open shift not found');
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });

    it('явный shiftId несуществующей смены → NotFound', async () => {
      const { service } = setup();
      await expect(
        service.addMovement(COMPANY, USER, {
          type: 'OUT',
          amount: 50,
          shiftId: 'nope',
        }),
      ).rejects.toThrow('Open shift not found');
    });
  });

  // ─────────────────────────── ТЕКУЩАЯ СМЕНА / ИСТОРИЯ ───────────────────────────
  describe('currentShift / listShifts', () => {
    it('currentShift возвращает Z-отчёт открытой смены кассира', async () => {
      const { store, service } = setup();
      const shift = seedShift(store, {
        userId: USER,
        closedAt: null,
        openingBalance: dec(0),
        payments: [pay({ method: 'CASH', amount: dec(75) })],
      });
      const rep: any = await service.currentShift(COMPANY, USER);
      expect(rep.id).toBe(shift.id);
      expect(rep.summary.cash).toBe(75);
    });

    it('currentShift → null, если открытой смены нет', async () => {
      const { service } = setup();
      const res = await service.currentShift(COMPANY, USER);
      expect(res).toBeNull();
    });

    it('listShifts: свежие сверху, isOpen/closingBalance корректны, Decimal → number', async () => {
      const { store, service } = setup();
      seedShift(store, {
        userId: USER,
        closedAt: null,
        openingBalance: dec(100),
        openedAt: new Date('2026-07-23T09:00:00.000Z'),
      });
      seedShift(store, {
        userId: USER,
        closedAt: new Date('2026-07-22T18:00:00.000Z'),
        openingBalance: dec(50),
        closingBalance: dec(80),
        openedAt: new Date('2026-07-22T09:00:00.000Z'),
      });

      const list = await service.listShifts(COMPANY);

      expect(list).toHaveLength(2);
      expect(list[0].isOpen).toBe(true);
      expect(list[0].closingBalance).toBeNull();
      expect(typeof list[0].openingBalance).toBe('number');
      expect(list[1].isOpen).toBe(false);
      expect(list[1].closingBalance).toBe(80);
    });
  });

  // ───────────── Гарантии, честно проверяемые только на ЖИВОЙ БД (integration) ─────────────
  // На моках нет реального unique-индекса, отката транзакции и сериализации строк —
  // здесь фейк доказывает лишь корректность выдаваемых запросов и реакции на их итог.
  describe('нужна живая БД (integration)', () => {
    it.todo(
      'ЖИВАЯ БД: partial-unique-индекс (companyId,userId,open) реально отклоняет ВТОРУЮ параллельную openShift (P2002) и откатывает вставку',
    );
    it.todo(
      'ЖИВАЯ БД: откат Prisma-транзакции — если запись аудита падает ПОСЛЕ create/updateMany/movement, смена/движение не сохраняются (нет денег без следа)',
    );
    it.todo(
      'ЖИВАЯ БД: две реально конкурентные closeShift сериализуются на строке — ровно один Z-отчёт/closingBalance, сверх app-level guard по count',
    );
    it.todo(
      'ЖИВАЯ БД: TOCTOU в addMovement — движение нельзя привязать к смене, закрытой между резолвом и вставкой (единая транзакция)',
    );
  });
});
