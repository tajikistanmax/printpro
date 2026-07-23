import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientType, OrderStatus } from '@prisma/client';
import request from 'supertest';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';

/**
 * Реальные бизнес-тесты модуля «Клиенты». Исходный код НЕ меняется —
 * логику проверяем, поднимая настоящий ClientsService/ClientsController и
 * подменяя только PrismaService мок-хранилищем, которое честно применяет те
 * же фильтры where (companyId / phone / id / deletedAt), что и продовая БД.
 * Если сервис забудет нормализовать телефон или потеряет `deletedAt: null` —
 * мок вернёт «не тот» результат и тест покраснеет. Это и есть проверка правил,
 * а не тавтология.
 */

// --- мок-хранилище клиентов, повторяющее фильтры Prisma, которыми пользуется сервис ---
type Row = {
  id: string;
  companyId: string;
  phone: string;
  fullName?: string | null;
  deletedAt: Date | null;
  discount?: number;
  creditLimit?: number;
  bonusPoints?: number;
  createdAt?: Date;
};

function matchClient(c: Row, where: any): boolean {
  if (where.companyId !== undefined && c.companyId !== where.companyId) return false;
  if (where.id !== undefined && c.id !== where.id) return false;
  if (where.phone !== undefined && c.phone !== where.phone) return false;
  // deletedAt: null означает «только живые» — это и есть soft-delete фильтр.
  if (where.deletedAt === null && c.deletedAt !== null) return false;
  return true;
}

function makeStorePrisma(rows: Row[]) {
  return {
    client: {
      findFirst: jest.fn(async ({ where }: any) => {
        return rows.find((c) => matchClient(c, where)) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 'created', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    clientFile: {
      create: jest.fn(async ({ data }: any) => ({ id: 'file-1', ...data })),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    order: {
      aggregate: jest.fn(async () => ({ _sum: {}, _count: 0 })),
      groupBy: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (arr: any) => Promise.all(arr)),
  };
}

describe('ClientsService — нормализация телефона (правило: «+992..» и без разделителей = один клиент)', () => {
  const EXISTING: Row = {
    id: 'c1',
    companyId: 'A',
    phone: '+992935555555', // хранится уже нормализованным
    fullName: 'Иван',
    deletedAt: null,
  };
  let prisma: ReturnType<typeof makeStorePrisma>;
  let service: ClientsService;

  beforeEach(() => {
    prisma = makeStorePrisma([{ ...EXISTING }]);
    service = new ClientsService(prisma as unknown as PrismaService);
  });

  // Один и тот же номер в разных форматах должен находить ОДНОГО существующего клиента.
  it.each([
    '+992 93-555-55-55',
    '+992 (93) 555 55 55',
    '+992-93-555-55-55',
    '+992935555555',
  ])('findOrCreate: формат «%s» находит существующего c1, а не плодит дубль', async (input) => {
    const res = await service.findOrCreate('A', input);
    expect(res).toEqual(EXISTING);
    // ключ поиска пришёл в нормализованном виде + фильтр soft-delete на месте
    expect(prisma.client.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'A',
          phone: '+992935555555',
          deletedAt: null,
        }),
      }),
    );
    expect(prisma.client.create).not.toHaveBeenCalled();
  });

  it('findOrCreate: новый номер (совпадений нет) → создаётся клиент с нормализованным телефоном', async () => {
    const res = await service.findOrCreate('A', '+992 90 111 22 33', 'Пётр');
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'A',
          phone: '+992901112233',
          fullName: 'Пётр',
        }),
      }),
    );
    expect(res).toEqual(expect.objectContaining({ phone: '+992901112233' }));
  });

  it.each(['', '()- ', '   '])(
    'findOrCreate: пустой/«мусорный» телефон «%s» НЕ ищет существующего (walk-in не привязывается к клиенту без телефона)',
    async (input) => {
      const res = await service.findOrCreate('A', input, 'Гость');
      // норм-телефон пустой → поиск пропускается, сразу create
      expect(prisma.client.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '' }) }),
      );
      expect(res).toEqual(expect.objectContaining({ phone: '' }));
    },
  );

  it('create(): нормализует телефон и подставляет дефолты discount=0/creditLimit=0', async () => {
    await service.create({ companyId: 'A', phone: '+992 93 555 55 55' } as any);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'A',
          phone: '+992935555555',
          discount: 0,
          creditLimit: 0,
        }),
      }),
    );
  });

  it('create(): переданные discount/creditLimit/type НЕ перетираются нулями', async () => {
    await service.create({
      companyId: 'A',
      phone: '992-93-000',
      discount: 15,
      creditLimit: 5000,
      type: ClientType.VIP,
    } as any);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '99293000',
          discount: 15,
          creditLimit: 5000,
          type: ClientType.VIP,
        }),
      }),
    );
  });

  it('update(): телефон при обновлении нормализуется (иначе findOrCreate потом не найдёт клиента → дубль)', async () => {
    await service.update('c1', { phone: '+992 93-555-00-00' } as any, 'A');
    expect(prisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ phone: '+992935550000' }),
      }),
    );
  });

  it('update(): без phone в dto телефон НЕ выставляется (не затирается пустой строкой)', async () => {
    await service.update('c1', { fullName: 'Новое имя' } as any, 'A');
    const arg = (prisma.client.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.fullName).toBe('Новое имя');
    expect(arg.data.phone).toBeUndefined();
  });
});

describe('ClientsService — soft-delete скрывает клиента (deletedAt != null)', () => {
  const ACTIVE: Row = { id: 'c1', companyId: 'A', phone: '+992935555555', deletedAt: null };
  const DELETED: Row = {
    id: 'c2',
    companyId: 'A',
    phone: '+992905550000',
    deletedAt: new Date('2026-01-01'),
  };
  let prisma: ReturnType<typeof makeStorePrisma>;
  let service: ClientsService;

  beforeEach(() => {
    prisma = makeStorePrisma([{ ...ACTIVE }, { ...DELETED }]);
    service = new ClientsService(prisma as unknown as PrismaService);
  });

  it('findOne удалённого клиента → NotFoundException (фильтр deletedAt:null прячет его)', async () => {
    await expect(service.findOne('c2', 'A')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update удалённого клиента → NotFoundException (ensure видит только живых), update НЕ вызывается', async () => {
    await expect(
      service.update('c2', { fullName: 'X' } as any, 'A'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.update).not.toHaveBeenCalled();
  });

  it('addFile удалённому клиенту → NotFoundException, clientFile.create НЕ вызывается', async () => {
    await expect(
      service.addFile('c2', '/uploads/x.pdf', 'A'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.clientFile.create).not.toHaveBeenCalled();
  });

  it('findOrCreate по телефону удалённого клиента НЕ воскрешает его, а создаёт нового', async () => {
    // тот же номер, что у c2, но в «человеческом» формате
    const res = await service.findOrCreate('A', '+992 90 555 00 00', 'Возврат');
    expect(res.id).not.toBe('c2');
    expect(prisma.client.create).toHaveBeenCalledTimes(1);
  });

  it('sanity: ЖИВОЙ клиент по-прежнему доступен (мок не «всегда null»)', async () => {
    await service.update('c1', { fullName: 'Обновлён' } as any, 'A');
    expect(prisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
  });
});

describe('ClientsService — доступный кредит в карточке клиента (findOne, регрессия P0-11)', () => {
  // findOne считает долг/оплату агрегатом по ВСЕМ заказам (не по обрезанному
  // take:50 списку) и исключает отменённые из долга. Проверяем и цифры, и то,
  // какие where уходят в aggregate.
  function makeCreditPrisma(
    client: any,
    sums: { paidSum: number; ordersCount: number; debtSum: number },
  ) {
    return {
      client: { findFirst: jest.fn(async () => client) },
      order: {
        aggregate: jest.fn(async ({ where }: any) => {
          if (where?.status?.not === OrderStatus.CANCELLED) {
            return { _sum: { balanceDue: sums.debtSum } };
          }
          return { _sum: { paid: sums.paidSum }, _count: sums.ordersCount };
        }),
      },
    };
  }

  const baseClient = (over: any = {}) => ({
    id: 'c1',
    companyId: 'A',
    fullName: 'Иван',
    discount: 0,
    creditLimit: 0,
    bonusPoints: 0,
    orders: [{ createdAt: new Date() }],
    files: [],
    ...over,
  });

  it('creditAvailable = лимит − долг; долг берётся из агрегата (все заказы, без отменённых)', async () => {
    const prisma = makeCreditPrisma(baseClient({ creditLimit: 10000 }), {
      paidSum: 7000,
      ordersCount: 60, // > 50: доказывает, что счёт идёт не по обрезанному списку orders
      debtSum: 3000,
    });
    const service = new ClientsService(prisma as unknown as PrismaService);

    const res = await service.findOne('c1', 'A');
    expect(res.stats.creditAvailable).toBe(7000); // 10000 − 3000
    expect(res.stats.totalDebt).toBe(3000);
    expect(res.stats.totalSpent).toBe(7000);
    expect(res.stats.ordersCount).toBe(60);
    expect(res.stats.avgCheck).toBe(116.67); // 7000/60

    // Долг считается по НЕотменённым заказам и по живым (deletedAt:null).
    const calls = (prisma.order.aggregate as jest.Mock).mock.calls.map((c) => c[0]);
    const debtCall = calls.find((a) => a.where?.status?.not === OrderStatus.CANCELLED);
    expect(debtCall).toBeDefined();
    expect(debtCall.where).toEqual(
      expect.objectContaining({ clientId: 'c1', companyId: 'A', deletedAt: null }),
    );
    // Оплата/счётчик — по ВСЕМ заказам клиента (deletedAt:null), без take:50.
    const spentCall = calls.find((a) => a.where && a.where.status === undefined);
    expect(spentCall.where).toEqual(
      expect.objectContaining({ clientId: 'c1', companyId: 'A', deletedAt: null }),
    );
  });

  it('creditLimit=0 (без лимита) → creditAvailable = null', async () => {
    const prisma = makeCreditPrisma(baseClient({ creditLimit: 0 }), {
      paidSum: 500,
      ordersCount: 2,
      debtSum: 100,
    });
    const service = new ClientsService(prisma as unknown as PrismaService);
    const res = await service.findOne('c1', 'A');
    expect(res.stats.creditAvailable).toBeNull();
  });

  it('долг больше лимита → creditAvailable отрицательный (виден перерасход)', async () => {
    const prisma = makeCreditPrisma(baseClient({ creditLimit: 1000 }), {
      paidSum: 0,
      ordersCount: 1,
      debtSum: 1500,
    });
    const service = new ClientsService(prisma as unknown as PrismaService);
    const res = await service.findOne('c1', 'A');
    expect(res.stats.creditAvailable).toBe(-500);
  });

  it('клиент без заказов → ordersCount 0, avgCheck 0, inactive true, creditAvailable = лимит', async () => {
    const prisma = makeCreditPrisma(baseClient({ creditLimit: 5000, orders: [] }), {
      paidSum: 0,
      ordersCount: 0,
      debtSum: 0,
    });
    const service = new ClientsService(prisma as unknown as PrismaService);
    const res = await service.findOne('c1', 'A');
    expect(res.stats.ordersCount).toBe(0);
    expect(res.stats.avgCheck).toBe(0);
    expect(res.stats.inactive).toBe(true);
    expect(res.stats.creditAvailable).toBe(5000);
  });
});

describe('Кредит-лимит в транзакции (гонка параллельных заказов) — требует живой БД', () => {
  // Логика живёт в OrdersService.create: внутри одной Prisma-транзакции строка
  // клиента блокируется `SELECT ... FOR UPDATE`, затем считается агрегат долга и
  // сравнивается с creditLimit. Смысл правила — что ДВА параллельных заказа не
  // проскочат лимит по отдельности — проявляется только при реальном уровне
  // изоляции READ COMMITTED и настоящей блокировке строки в Postgres. На jest-
  // моках PrismaService это недостижимо (нет транзакций/локов/конкуренции), а
  // «эмуляция» была бы проверкой самого мока, а не кода. Поэтому — it.todo и
  // возврат в todosNeedingDb, чтобы правило закрыли интеграционным тестом на БД.
  it.todo(
    'два одновременных заказа при долге у лимита: первый проходит, второй ловит «Превышен кредитный лимит» (нужна реальная транзакция Prisma + FOR UPDATE)',
  );
  it.todo(
    'заказ, укладывающийся в creditLimit, создаётся; заказ, превышающий (долг+total>limit), откатывается целиком (нужна реальная транзакция Prisma)',
  );
});

describe('ClientsController — изоляция арендаторов (companyId берётся из токена, не из тела)', () => {
  let app: INestApplication;
  const svc = {
    create: jest.fn(async (dto: any) => ({ id: 'c-new', ...dto })),
    findOne: jest.fn(async (id: string, companyId: string) => ({
      id,
      companyId,
      source: 'service',
    })),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [{ provide: ClientsService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = {
            sub: 'u1',
            companyId: 'TOKEN-CO',
            roleId: 'r1',
          };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    svc.create.mockClear();
    svc.findOne.mockClear();
  });

  it('POST /clients: companyId из тела («EVIL-CO») игнорируется, используется companyId токена', async () => {
    const res = await request(app.getHttpServer())
      .post('/clients')
      .send({ companyId: 'EVIL-CO', phone: '+992 93 000 00 00', fullName: 'X' })
      .expect(201);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'TOKEN-CO' }),
    );
    expect(svc.create.mock.calls[0][0].companyId).not.toBe('EVIL-CO');
    expect(res.body.companyId).toBe('TOKEN-CO');
  });

  it('GET /clients/:id: в сервис уходит companyId из токена (нельзя читать чужого клиента)', async () => {
    await request(app.getHttpServer()).get('/clients/some-id').expect(200);
    expect(svc.findOne).toHaveBeenCalledWith('some-id', 'TOKEN-CO');
  });
});
