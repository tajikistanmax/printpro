import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemType, OrderType, Prisma, QuoteStatus } from '@prisma/client';
import { QuotesService } from './quotes.service';

/**
 * Юнит-тесты QuotesService на моках PrismaService / ClientsService / OrdersService.
 *
 * Фокус (по заданию): конвертация КП в заказ должна быть АТОМАРНОЙ и ОДНОРАЗОВОЙ
 * (маркер convertedOrderId='CONVERTING' → id заказа) и корректно ПЕРЕНОСИТЬ
 * позиции (Decimal-поля Prisma → number). Плюс поддерживающие проверки create:
 * математика строк/итога и запрет cross-tenant товаров/услуг.
 *
 * Prisma-клиент, ClientsService и OrdersService подменяются jest-моками, поэтому
 * исходный код модуля не меняется. Реальная СУБД не поднимается.
 */

// Позиция КП, как её возвращает Prisma: Decimal в количестве/цене/сумме.
type QuoteItemRow = {
  itemType: ItemType;
  serviceId: string | null;
  productId: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

function dec(v: string | number): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

function makeQuote(overrides: Partial<Record<string, unknown>> = {}) {
  const items: QuoteItemRow[] = [
    {
      itemType: ItemType.SERVICE,
      serviceId: 'svc-1',
      productId: null,
      description: 'Дизайн',
      quantity: dec('2'),
      unitPrice: dec('150.50'),
      lineTotal: dec('301.00'),
    },
    {
      itemType: ItemType.PRODUCT,
      serviceId: null,
      productId: 'prd-1',
      description: null,
      quantity: dec('3'),
      unitPrice: dec('0.10'),
      lineTotal: dec('0.30'),
    },
  ];
  return {
    id: 'quote-1',
    companyId: 'co-1',
    clientId: 'client-1',
    number: 'КП-C-2026-00001',
    title: 'Печать баннеров',
    note: null,
    status: QuoteStatus.DRAFT,
    convertedOrderId: null,
    total: dec('301.30'),
    items,
    client: { id: 'client-1', fullName: 'Иван', phone: '+992900000000' },
    ...overrides,
  };
}

function createMocks() {
  const prisma = {
    client: { findFirst: jest.fn() },
    service: { findMany: jest.fn() },
    product: { findMany: jest.fn() },
    quote: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const clients = { findOrCreate: jest.fn() };
  const orders = { create: jest.fn() };
  const service = new QuotesService(
    prisma as never,
    clients as never,
    orders as never,
  );
  return { prisma, clients, orders, service };
}

let ctx: ReturnType<typeof createMocks>;
beforeEach(() => {
  ctx = createMocks();
});

describe('QuotesService.convert — атомарность, одноразовость, перенос позиций', () => {
  it('happy-path: конвертирует допустимое КП, переносит позиции (Decimal→number) и ставит маркер = id заказа', async () => {
    const { service, prisma, orders } = ctx;
    prisma.quote.findFirst.mockResolvedValue(makeQuote());
    prisma.quote.updateMany.mockResolvedValue({ count: 1 }); // claim удался
    orders.create.mockResolvedValue({ id: 'order-777' });
    prisma.quote.update.mockResolvedValue({});

    const result = await service.convert('quote-1', 'co-1');

    // Возвращается созданный заказ.
    expect(result).toEqual({ id: 'order-777' });

    // Заказ создан ровно один раз с корректно перенесёнными позициями.
    expect(orders.create).toHaveBeenCalledTimes(1);
    const payload = orders.create.mock.calls[0][0];
    expect(payload.companyId).toBe('co-1');
    expect(payload.clientId).toBe('client-1');
    expect(payload.orderType).toBe(OrderType.PRINT);
    // note берётся из title (приоритет над note).
    expect(payload.note).toBe('Печать баннеров');

    // Позиции перенесены и приведены к number (не Decimal-объекты).
    expect(payload.items).toEqual([
      {
        itemType: ItemType.SERVICE,
        serviceId: 'svc-1',
        productId: undefined,
        description: 'Дизайн',
        quantity: 2,
        unitPrice: 150.5,
      },
      {
        itemType: ItemType.PRODUCT,
        serviceId: undefined,
        productId: 'prd-1',
        description: undefined,
        quantity: 3,
        unitPrice: 0.1,
      },
    ]);
    expect(typeof payload.items[0].quantity).toBe('number');
    expect(typeof payload.items[0].unitPrice).toBe('number');

    // Атомарный «захват»: updateMany с охраной convertedOrderId=null и
    // допустимым статусом, ставящий маркер 'CONVERTING'.
    expect(prisma.quote.updateMany).toHaveBeenCalledTimes(1);
    const claim = prisma.quote.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual(
      expect.objectContaining({
        id: 'quote-1',
        companyId: 'co-1',
        convertedOrderId: null,
      }),
    );
    expect(claim.where.status.in).toEqual(
      expect.arrayContaining([
        QuoteStatus.DRAFT,
        QuoteStatus.SENT,
        QuoteStatus.ACCEPTED,
      ]),
    );
    expect(claim.data.convertedOrderId).toBe('CONVERTING');

    // Финальная фиксация: маркер = реальный id заказа.
    expect(prisma.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'quote-1' },
        data: { convertedOrderId: 'order-777' },
      }),
    );
  });

  it('одноразовость: уже сконвертированное КП (convertedOrderId задан) → BadRequest, без захвата и без создания заказа', async () => {
    const { service, prisma, orders } = ctx;
    prisma.quote.findFirst.mockResolvedValue(
      makeQuote({ convertedOrderId: 'order-existing', status: QuoteStatus.ACCEPTED }),
    );

    await expect(service.convert('quote-1', 'co-1')).rejects.toThrow(
      BadRequestException,
    );
    // Ранняя проверка — до атомарного захвата.
    expect(prisma.quote.updateMany).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('гонка: КП было свободно при чтении, но claim перехвачен параллельно (count=0) → BadRequest, второй заказ не создаётся', async () => {
    const { service, prisma, orders } = ctx;
    prisma.quote.findFirst.mockResolvedValue(makeQuote()); // convertedOrderId=null
    prisma.quote.updateMany.mockResolvedValue({ count: 0 }); // захват не удался

    await expect(service.convert('quote-1', 'co-1')).rejects.toThrow(
      BadRequestException,
    );
    // Захват сорвался → заказ НЕ создаём, финальную фиксацию НЕ делаем.
    expect(orders.create).not.toHaveBeenCalled();
    expect(prisma.quote.update).not.toHaveBeenCalled();
  });

  it('отклонённое КП (REJECTED) нельзя превратить в заказ → BadRequest, без захвата', async () => {
    const { service, prisma, orders } = ctx;
    prisma.quote.findFirst.mockResolvedValue(
      makeQuote({ status: QuoteStatus.REJECTED }),
    );

    await expect(service.convert('quote-1', 'co-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.quote.updateMany).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('сбой создания заказа → захват отпускается (CONVERTING→null), исходная ошибка пробрасывается, маркер не фиксируется', async () => {
    const { service, prisma, orders } = ctx;
    prisma.quote.findFirst.mockResolvedValue(makeQuote());
    prisma.quote.updateMany.mockResolvedValue({ count: 1 }); // и claim, и release
    orders.create.mockRejectedValue(new Error('order failed'));
    prisma.quote.update.mockResolvedValue({});

    await expect(service.convert('quote-1', 'co-1')).rejects.toThrow(
      'order failed',
    );

    // Второй вызов updateMany — освобождение захвата.
    expect(prisma.quote.updateMany).toHaveBeenCalledTimes(2);
    const release = prisma.quote.updateMany.mock.calls[1][0];
    expect(release.where).toEqual(
      expect.objectContaining({
        id: 'quote-1',
        convertedOrderId: 'CONVERTING',
      }),
    );
    expect(release.data).toEqual({ convertedOrderId: null });

    // Финальная фиксация маркера НЕ выполняется при сбое.
    expect(prisma.quote.update).not.toHaveBeenCalled();
  });

  it('note берётся из note, если title пуст; и undefined, если оба пусты', async () => {
    const { service, prisma, orders } = ctx;
    prisma.quote.updateMany.mockResolvedValue({ count: 1 });
    orders.create.mockResolvedValue({ id: 'order-1' });
    prisma.quote.update.mockResolvedValue({});

    // title=null, note задан → используем note.
    prisma.quote.findFirst.mockResolvedValue(
      makeQuote({ title: null, note: 'Только заметка', status: QuoteStatus.SENT }),
    );
    await service.convert('quote-1', 'co-1');
    expect(orders.create.mock.calls[0][0].note).toBe('Только заметка');

    // title=null и note=null → note = undefined.
    orders.create.mockClear();
    prisma.quote.findFirst.mockResolvedValue(
      makeQuote({ title: null, note: null }),
    );
    await service.convert('quote-1', 'co-1');
    expect(orders.create.mock.calls[0][0].note).toBeUndefined();
  });

  it('несуществующее/мягко удалённое КП → NotFound (convert опирается на findOne c deletedAt:null)', async () => {
    const { service, prisma, orders } = ctx;
    prisma.quote.findFirst.mockResolvedValue(null);

    await expect(service.convert('missing', 'co-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.quote.updateMany).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
  });

  // Настоящая атомарность одиночного условного UPDATE ... WHERE convertedOrderId
  // IS NULL под РЕАЛЬНОЙ конкурентной нагрузкой (два параллельных convert →
  // ровно один заказ) — это свойство СУБД (сериализация updateMany в Postgres).
  // На моках проверяется лишь ветка count===0; сам гоночный инвариант требует
  // живой транзакции Prisma.
  it.todo(
    'РЕАЛЬНАЯ атомарность claim: два конкурентных convert над одним КП создают ровно один заказ (нужна живая БД Postgres)',
  );
});

describe('QuotesService.create — математика позиций и tenant-изоляция товаров/услуг', () => {
  function baseDto() {
    return {
      companyId: 'co-1',
      clientId: 'client-1',
      title: 'КП тест',
      items: [
        { itemType: ItemType.SERVICE, serviceId: 'svc-1', quantity: 3, unitPrice: 0.1 },
        { itemType: ItemType.PRODUCT, productId: 'prd-1', quantity: 2, unitPrice: 10.5 },
      ],
    } as never;
  }

  it('считает lineTotal (с округлением) и total, персистит позиции, генерирует номер с 5-значным счётчиком', async () => {
    const { service, prisma } = ctx;
    prisma.client.findFirst.mockResolvedValue({ id: 'client-1' });
    prisma.service.findMany.mockResolvedValue([{ id: 'svc-1' }]);
    prisma.product.findMany.mockResolvedValue([{ id: 'prd-1' }]);
    prisma.$queryRaw.mockResolvedValue([{ value: 7 }]); // nextSeq → 7
    prisma.quote.create.mockResolvedValue({ id: 'quote-new' });

    await service.create(baseDto());

    const data = prisma.quote.create.mock.calls[0][0].data;
    // 3 * 0.1 = 0.30000000000000004 → округление до 0.3; 2 * 10.5 = 21.
    const created = data.items.create;
    expect(created).toHaveLength(2);
    expect(created[0].lineTotal).toBe(0.3);
    expect(created[1].lineTotal).toBe(21);
    // total = сумма строк.
    expect(data.total).toBe(21.3);
    expect(data.companyId).toBe('co-1');
    expect(data.clientId).toBe('client-1');
    // Номер: КП-<node>-<год>-00007 (padStart(5)).
    expect(data.number).toMatch(/^КП-[A-Z0-9]+-\d{4}-00007$/);
    expect(data.number).toContain(String(new Date().getFullYear()));
  });

  it('clientId задан, но клиент не найден в компании → BadRequest, КП не создаётся', async () => {
    const { service, prisma } = ctx;
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(service.create(baseDto())).rejects.toThrow(BadRequestException);
    expect(prisma.quote.create).not.toHaveBeenCalled();
  });

  it('cross-tenant: услуга из другой компании (findMany вернул меньше id) → BadRequest «Услуга не найдена»', async () => {
    const { service, prisma } = ctx;
    prisma.client.findFirst.mockResolvedValue({ id: 'client-1' });
    prisma.service.findMany.mockResolvedValue([]); // svc-1 не принадлежит co-1
    prisma.product.findMany.mockResolvedValue([{ id: 'prd-1' }]);

    await expect(service.create(baseDto())).rejects.toThrow('Услуга не найдена');
    expect(prisma.quote.create).not.toHaveBeenCalled();
  });

  it('cross-tenant: товар из другой компании → BadRequest «Товар не найден»', async () => {
    const { service, prisma } = ctx;
    prisma.client.findFirst.mockResolvedValue({ id: 'client-1' });
    prisma.service.findMany.mockResolvedValue([{ id: 'svc-1' }]);
    prisma.product.findMany.mockResolvedValue([]); // prd-1 не принадлежит co-1

    await expect(service.create(baseDto())).rejects.toThrow('Товар не найден');
    expect(prisma.quote.create).not.toHaveBeenCalled();
  });

  it('без clientId, но с телефоном → клиент находится/создаётся, его id уходит в КП', async () => {
    const { service, prisma, clients } = ctx;
    clients.findOrCreate.mockResolvedValue({ id: 'client-created' });
    prisma.$queryRaw.mockResolvedValue([{ value: 1 }]);
    prisma.quote.create.mockResolvedValue({ id: 'quote-new' });

    await service.create({
      companyId: 'co-1',
      clientPhone: '+992 90 000-00-00',
      clientName: 'Пётр',
      items: [
        { itemType: ItemType.SERVICE, description: 'Правка', quantity: 1, unitPrice: 50 },
      ],
    } as never);

    expect(clients.findOrCreate).toHaveBeenCalledWith(
      'co-1',
      '+992 90 000-00-00',
      'Пётр',
    );
    expect(prisma.quote.create.mock.calls[0][0].data.clientId).toBe('client-created');
  });
});

describe('QuotesService — чтение/статус/удаление (tenant-изоляция и soft-delete)', () => {
  it('findOne: не найдено → NotFound; поиск ограничен companyId и deletedAt:null', async () => {
    const { service, prisma } = ctx;
    prisma.quote.findFirst.mockResolvedValue(null);

    await expect(service.findOne('q1', 'co-1')).rejects.toThrow(NotFoundException);
    expect(prisma.quote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'q1',
          companyId: 'co-1',
          deletedAt: null,
        }),
      }),
    );
  });

  it('updateStatus: сначала проверяет существование (findOne), затем обновляет статус', async () => {
    const { service, prisma } = ctx;
    prisma.quote.findFirst.mockResolvedValue(makeQuote());
    prisma.quote.update.mockResolvedValue({ id: 'quote-1', status: QuoteStatus.SENT });

    await service.updateStatus('quote-1', 'co-1', QuoteStatus.SENT);

    expect(prisma.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'quote-1' },
        data: { status: QuoteStatus.SENT },
      }),
    );
  });

  it('updateStatus по несуществующему КП → NotFound, update не вызывается', async () => {
    const { service, prisma } = ctx;
    prisma.quote.findFirst.mockResolvedValue(null);

    await expect(
      service.updateStatus('nope', 'co-1', QuoteStatus.ACCEPTED),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.quote.update).not.toHaveBeenCalled();
  });

  it('remove: мягкое удаление (проставляет deletedAt), возвращает {ok:true}', async () => {
    const { service, prisma } = ctx;
    prisma.quote.findFirst.mockResolvedValue(makeQuote());
    prisma.quote.update.mockResolvedValue({});

    const res = await service.remove('quote-1', 'co-1');

    expect(res).toEqual({ ok: true });
    const call = prisma.quote.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'quote-1' });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it('findAll: фильтр по статусу применяется только когда он передан', async () => {
    const { service, prisma } = ctx;
    prisma.quote.findMany.mockResolvedValue([]);

    await service.findAll('co-1', QuoteStatus.SENT);
    expect(prisma.quote.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        companyId: 'co-1',
        deletedAt: null,
        status: QuoteStatus.SENT,
      }),
    );

    prisma.quote.findMany.mockClear();
    await service.findAll('co-1');
    expect(prisma.quote.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });
});
