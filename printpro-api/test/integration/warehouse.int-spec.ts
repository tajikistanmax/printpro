import { StockMovementType } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { StockService } from '../../src/warehouse/stock.service';
import { makePrisma, truncateAll } from './_db';

/**
 * Интеграционные тесты склада (StockService) на ЖИВОМ Postgres (отдельная тестовая
 * БД printpro_test_warehouse). Здесь доказываются гарантии УРОВНЯ БД, которые НЕ
 * воспроизводятся на моках Prisma (unit-спек пометил их it.todo):
 *
 *  1) РЕАЛЬНАЯ атомарность условного списания `updateMany WHERE quantity >= N`
 *     под конкуренцией: две одновременные adjust / writeOff / transfer НЕ уводят
 *     остаток в минус — ровно одна проходит, вторая честно отклонена базой.
 *  2) РЕАЛЬНЫЙ unique-индекс StockMovement.idempotencyKey: дубль ключа роняет
 *     вторую вставку (P2002) и откатывает всю транзакцию — в БД одна запись.
 *  3) РЕАЛЬНЫЙ откат Prisma-транзакции: падение шага аудита ПОСЛЕ мутации стока
 *     возвращает остаток к исходному (нет движения склада без следа).
 *  4) РЕАЛЬНЫЙ SELECT … FOR UPDATE в recount: конкурентный приход между чтением
 *     «было» и перезаписью НЕ теряется (нет lost update).
 *
 * Сервис поднимается НАСТОЯЩИЙ: реальный PrismaService (тестовая БД) и реальный
 * AuditService(prisma). Внешних I/O у StockService нет — конструктор (prisma,
 * audit), см. src/warehouse/stock.service.spec.ts. Инварианты проверяются
 * ЗАПРОСОМ В БД, а не по возвращённым значениям.
 */
describe('Интеграция (живой Postgres): warehouse/StockService — гарантии уровня БД', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  let service: StockService;

  beforeAll(async () => {
    prisma = makePrisma();
    await prisma.$connect();
    audit = new AuditService(prisma);
    service = new StockService(prisma, audit);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(() => {
    // Снять spy на audit (см. тест отката), чтобы не текли между тестами.
    jest.restoreAllMocks();
  });

  // --- сид: компания + филиал + кладовщик + товар -----------------------------
  async function seedBase() {
    const company = await prisma.company.create({ data: { name: 'ACME-WH' } });
    const branch = await prisma.branch.create({
      data: { companyId: company.id, name: 'Главный склад' },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        login: 'stockman',
        passwordHash: 'x',
        fullName: 'Кладовщик',
      },
    });
    const product = await prisma.product.create({
      data: { companyId: company.id, name: 'Бумага A4', purchasePrice: 5 },
    });
    return { company, branch, user, product };
  }

  // Выставить абсолютный остаток по позиции/филиалу (сид стока перед гонкой).
  async function setStock(productId: string, branchId: string, quantity: number) {
    await prisma.stock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity },
      update: { quantity },
    });
  }

  // Текущий остаток по позиции/филиалу из БД (число). Нет строки → 0.
  async function getQty(productId: string, branchId: string): Promise<number> {
    const row = await prisma.stock.findUnique({
      where: { productId_branchId: { productId, branchId } },
    });
    return row ? Number(row.quantity) : 0;
  }

  // ===========================================================================
  // Happy-path якорь: реальная транзакция КОММИТИТСЯ целиком (опора для теста
  // отката — по контрасту видно, что при сбое ничего не остаётся).
  // ===========================================================================
  it('happy: receive() коммитит целиком — остаток +N, движение IN и запись аудита в БД', async () => {
    const { company, branch, product, user } = await seedBase();

    const res = await service.receive({
      companyId: company.id,
      branchId: branch.id,
      productId: product.id,
      quantity: 10,
      userId: user.id,
    } as any);
    expect(Number((res as any).quantity)).toBe(10);

    // Остаток реально появился в БД.
    expect(await getQty(product.id, branch.id)).toBe(10);

    // Движение IN записано с фактическим «после».
    const moves = await prisma.stockMovement.findMany({
      where: { productId: product.id },
    });
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe(StockMovementType.IN);
    expect(Number(moves[0].afterQty)).toBe(10);

    // След в аудите (нет движения склада без записи).
    const audits = await prisma.auditLog.count({
      where: { entityId: product.id, action: 'stock:receive' },
    });
    expect(audits).toBe(1);
  });

  // ===========================================================================
  // (1a) ГОНКА adjust: две одновременные корректировки НЕ уводят остаток в минус.
  // Сериализацию даёт САМА БД: row-lock + перепроверка `quantity >= N` после
  // коммита соперника (updateMany вернёт count=0 → отказ), а не app-счётчик.
  // ===========================================================================
  it('две конкурентные adjust НЕ уводят остаток в минус (updateMany quantity>=N): ровно одна проходит, итог 0', async () => {
    const { company, branch, product, user } = await seedBase();
    await setStock(product.id, branch.id, 10);

    const dto = {
      companyId: company.id,
      branchId: branch.id,
      productId: product.id,
      quantity: 10,
      type: StockMovementType.ADJUST,
      userId: user.id,
    };
    // Оба списывают по 10 из 10 — арифметически пройти может только один.
    const results = await Promise.allSettled([
      service.adjust({ ...dto } as any),
      service.adjust({ ...dto } as any),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason?.message).toMatch(
      /Недостаточно/i,
    );

    // Инвариант в БД: остаток ровно 0 и НЕ ушёл в минус.
    const qty = await getQty(product.id, branch.id);
    expect(qty).toBe(0);
    expect(qty).toBeGreaterThanOrEqual(0);

    // Проигравшая транзакция не оставила следа — ровно одно движение.
    const moves = await prisma.stockMovement.count({
      where: {
        productId: product.id,
        branchId: branch.id,
        type: StockMovementType.ADJUST,
      },
    });
    expect(moves).toBe(1);
  });

  // ===========================================================================
  // (1b) ГОНКА writeOff: два одновременных списания (бой/брак) НЕ уводят в минус —
  // ровно один документ WriteOff и одно движение WRITE_OFF.
  // ===========================================================================
  it('две конкурентные writeOff НЕ уводят остаток в минус: один документ WriteOff + одно движение WRITE_OFF', async () => {
    const { company, branch, product, user } = await seedBase();
    await setStock(product.id, branch.id, 6);

    const dto = {
      companyId: company.id,
      branchId: branch.id,
      productId: product.id,
      quantity: 6,
      reason: 'бой',
      userId: user.id,
    };
    const results = await Promise.allSettled([
      service.writeOff({ ...dto } as any),
      service.writeOff({ ...dto } as any),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason?.message).toMatch(
      /Недостаточно/i,
    );

    // Остаток обнулён, не отрицателен.
    const qty = await getQty(product.id, branch.id);
    expect(qty).toBe(0);
    expect(qty).toBeGreaterThanOrEqual(0);

    // Ровно один документ списания и ровно одно движение WRITE_OFF.
    const woCount = await prisma.writeOff.count({
      where: { productId: product.id },
    });
    expect(woCount).toBe(1);
    const moves = await prisma.stockMovement.count({
      where: { productId: product.id, type: StockMovementType.WRITE_OFF },
    });
    expect(moves).toBe(1);
  });

  // ===========================================================================
  // (1c) ГОНКА transfer: два одновременных перемещения из одного источника НЕ
  // уводят источник в минус; приёмник пополняется РОВНО один раз (не дважды).
  // ===========================================================================
  it('две конкурентные transfer из одного источника: источник не в минусе, приёмник пополнен один раз', async () => {
    const { company, branch: from, product, user } = await seedBase();
    const to = await prisma.branch.create({
      data: { companyId: company.id, name: 'Филиал 2' },
    });
    await setStock(product.id, from.id, 10);

    const dto = {
      companyId: company.id,
      productId: product.id,
      fromBranchId: from.id,
      toBranchId: to.id,
      quantity: 10,
      userId: user.id,
    };
    const results = await Promise.allSettled([
      service.transfer({ ...dto } as any),
      service.transfer({ ...dto } as any),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason?.message).toMatch(
      /Недостаточно товара в филиале-источнике/i,
    );

    // Источник ушёл в 0 (не -10), приёмник получил ровно 10 (не 20).
    expect(await getQty(product.id, from.id)).toBe(0);
    expect(await getQty(product.id, to.id)).toBe(10);

    // Ровно два движения (OUT из источника + IN в приёмник) от единственного успешного перевода.
    const moves = await prisma.stockMovement.count({
      where: { productId: product.id },
    });
    expect(moves).toBe(2);
  });

  // ===========================================================================
  // (2a) UNIQUE-ИНДЕКС детерминированно: если ключ идемпотентности уже занят на
  // StockMovement, вставка нового движения с тем же ключом падает на P2002 и
  // ОТКАТЫВАЕТ всю операцию writeOff (остаток и документ не сохраняются).
  //
  // Приём: writeOff проверяет дубль по таблице WriteOff, а не StockMovement.
  // Поэтому предзаписанное движение с ключом (без документа WriteOff) не ловится
  // app-проверкой — сервис доходит до вставки StockMovement и упирается в @unique.
  // ===========================================================================
  it('дубль idempotencyKey: @unique(StockMovement.idempotencyKey) роняет вставку (P2002) и откатывает всю операцию', async () => {
    const { company, branch, product, user } = await seedBase();
    await setStock(product.id, branch.id, 100);
    const KEY = 'dup-key-stockmove';

    // Ключ уже занят движением (напр. осталось от прошлой транзакции), но
    // документа WriteOff с этим ключом НЕТ — app-проверка writeOff его не увидит.
    await prisma.stockMovement.create({
      data: {
        companyId: company.id,
        productId: product.id,
        branchId: branch.id,
        type: StockMovementType.ADJUST,
        quantity: 1,
        idempotencyKey: KEY,
      },
    });

    // writeOff.findFirst(key)→null → сервис спишет остаток, создаст WriteOff, затем
    // упрётся в @unique на StockMovement.idempotencyKey → P2002 → откат всего.
    await expect(
      service.writeOff({
        companyId: company.id,
        branchId: branch.id,
        productId: product.id,
        quantity: 5,
        reason: 'бой',
        userId: user.id,
        idempotencyKey: KEY,
      } as any),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Полный откат: остаток не тронут…
    expect(await getQty(product.id, branch.id)).toBe(100);
    // …документ WriteOff не сохранён…
    expect(await prisma.writeOff.count({ where: { companyId: company.id } })).toBe(0);
    // …движение с ключом по-прежнему РОВНО одно (предзаписанное), дубля нет.
    expect(
      await prisma.stockMovement.count({ where: { idempotencyKey: KEY } }),
    ).toBe(1);
  });

  // ===========================================================================
  // (2b) UNIQUE-ИНДЕКС под ГОНКОЙ: две одновременные adjust с ОДНИМ ключом. Даже
  // если обе прошли app-проверку дубля (обе увидели null), @unique гарантирует,
  // что в БД останется РОВНО одно движение с этим ключом, а остаток уменьшится
  // ровно один раз. Проигравшая (если проиграла на вставке) падает именно на P2002.
  // ===========================================================================
  it('гонка одинакового idempotencyKey (две adjust): в БД ровно одно движение с ключом, остаток списан один раз', async () => {
    const { company, branch, product, user } = await seedBase();
    await setStock(product.id, branch.id, 1000);
    const KEY = 'race-key';

    const dto = {
      companyId: company.id,
      branchId: branch.id,
      productId: product.id,
      quantity: 1,
      type: StockMovementType.ADJUST,
      userId: user.id,
      idempotencyKey: KEY,
    };
    const results = await Promise.allSettled([
      service.adjust({ ...dto } as any),
      service.adjust({ ...dto } as any),
    ]);

    // Не более одного отказа; любой отказ — это именно нарушение unique-индекса.
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeLessThanOrEqual(1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason?.code).toBe('P2002');
    }

    // Главный инвариант БД: ключ идемпотентности НЕ задвоился — ровно одно движение.
    expect(
      await prisma.stockMovement.count({ where: { idempotencyKey: KEY } }),
    ).toBe(1);
    // И остаток уменьшен ровно один раз (1000 → 999), не дважды.
    expect(await getQty(product.id, branch.id)).toBe(999);
  });

  // ===========================================================================
  // (3) ОТКАТ: сбой шага аудита ВНУТРИ транзакции adjust (уже ПОСЛЕ updateMany,
  // уменьшившего остаток) откатывает ВСЁ — в БД остаток исходный, движения нет.
  // Роняем последний шаг транзакции — audit.recordTx (spy с throw).
  // ===========================================================================
  it('ОТКАТ: сбой audit.recordTx в adjust возвращает остаток к исходному, движение и аудит не записаны', async () => {
    const { company, branch, product, user } = await seedBase();
    await setStock(product.id, branch.id, 10);

    // Аудит падает уже ПОСЛЕ атомарного decrement 10→6 внутри транзакции.
    jest
      .spyOn(audit, 'recordTx')
      .mockRejectedValueOnce(new Error('boom: audit tx failed'));

    await expect(
      service.adjust({
        companyId: company.id,
        branchId: branch.id,
        productId: product.id,
        quantity: 4,
        type: StockMovementType.ADJUST,
        userId: user.id,
      } as any),
    ).rejects.toThrow('boom');

    // Транзакция откатилась целиком: остаток по-прежнему 10 (списание отменено).
    expect(await getQty(product.id, branch.id)).toBe(10);
    // Ни движения склада, ни записи аудита не осталось.
    expect(
      await prisma.stockMovement.count({
        where: { productId: product.id, branchId: branch.id },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: product.id, action: 'stock:adjust' },
      }),
    ).toBe(0);

    // После снятия сбоя списание проходит и корректно фиксируется (10 → 6).
    const ok = await service.adjust({
      companyId: company.id,
      branchId: branch.id,
      productId: product.id,
      quantity: 4,
      type: StockMovementType.ADJUST,
      userId: user.id,
    } as any);
    expect(Number((ok as any).quantity)).toBe(6);
    expect(await getQty(product.id, branch.id)).toBe(6);
  });

  // ===========================================================================
  // (4) FOR UPDATE в recount: конкурентный приход (+5) между чтением «было» и
  // перезаписью НЕ теряется. recount блокирует строку стока (SELECT … FOR UPDATE),
  // поэтому его «было» — это фактический остаток на момент блокировки, а не
  // устаревший снимок. Проверяем order-independent инвариант: цепочка до/после у
  // двух движений НЕПРЕРЫВНА при любом порядке коммита (нет lost update).
  // ===========================================================================
  it('recount под FOR UPDATE не теряет конкурентный приход: цепочка «до/после» непрерывна при любом порядке', async () => {
    const { company, branch, product, user } = await seedBase();
    await setStock(product.id, branch.id, 10);

    // Одновременно: инвентаризация до абсолютных 100 И приход +5 по той же позиции.
    const results = await Promise.allSettled([
      service.recount({
        companyId: company.id,
        branchId: branch.id,
        productId: product.id,
        countedQuantity: 100,
        userId: user.id,
      } as any),
      service.receive({
        companyId: company.id,
        branchId: branch.id,
        productId: product.id,
        quantity: 5,
        userId: user.id,
      } as any),
    ]);
    // Обе операции корректны и должны пройти (разные виды мутаций одной строки).
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);

    const adj = await prisma.stockMovement.findFirst({
      where: { productId: product.id, type: StockMovementType.ADJUST },
    });
    const inMove = await prisma.stockMovement.findFirst({
      where: { productId: product.id, type: StockMovementType.IN },
    });
    expect(adj).not.toBeNull();
    expect(inMove).not.toBeNull();

    const finalQty = await getQty(product.id, branch.id);
    // Приход всегда добавляет РОВНО +5 (его инкремент не потерян ни в одном порядке).
    expect(Number(inMove!.afterQty) - Number(inMove!.beforeQty)).toBe(5);
    // recount всегда перезаписывает в 100.
    expect(Number(adj!.afterQty)).toBe(100);

    if (finalQty === 105) {
      // Порядок: recount закоммитил ПЕРВЫМ (10→100), затем приход (100→105).
      expect(Number(adj!.beforeQty)).toBe(10);
      expect(Number(inMove!.beforeQty)).toBe(100); // приход увидел перезаписанные 100
    } else {
      // Порядок: приход ПЕРВЫМ (10→15), затем recount под FOR UPDATE увидел 15,
      // а НЕ устаревшие 10 → +5 не потерян, итог ровно 100.
      expect(finalQty).toBe(100);
      expect(Number(inMove!.beforeQty)).toBe(10);
      expect(Number(inMove!.afterQty)).toBe(15);
      expect(Number(adj!.beforeQty)).toBe(15);
    }
  });
});
