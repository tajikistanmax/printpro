import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ReceiptPaymentStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { PurchasingService } from '../../src/purchasing/purchasing.service';
import { makePrisma, truncateAll } from './_db';

/**
 * Интеграционные тесты закупок на ЖИВОМ Postgres (отдельная тестовая БД).
 * Сервис поднимаем с НАСТОЯЩИМ PrismaService и НАСТОЯЩИМ AuditService — без моков
 * персистентности. Здесь доказываются гарантии УРОВНЯ БД, которые unit-тесты с
 * моками проверить не могут (в spec они помечены it.todo):
 *   1) атомарность списания долга при гонке (updateMany + guard debt >= pay);
 *   2) откат ВСЕЙ приёмки при падении шага внутри Prisma-транзакции (аудит);
 *   3) FIFO-погашение приёмок по дате — сортировку выполняет сама БД (orderBy date asc).
 */

// -------------------- seed-хелперы (минимальные данные под сценарий) --------------------

interface SeedOpts {
  debt?: number; // стартовый долг поставщику
  withShift?: boolean; // открытая смена кассира (нужна для расходов кассы)
  purchasePrice?: number; // стартовая закупочная цена товара
  stockQty?: number; // стартовый остаток товара на филиале
}

async function seedBase(prisma: PrismaService, opts: SeedOpts = {}) {
  const company = await prisma.company.create({ data: { name: 'ACME интеграция' } });
  const branch = await prisma.branch.create({
    data: { companyId: company.id, name: 'Главный' },
  });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      login: 'cashier',
      passwordHash: 'x',
      fullName: 'Кассир Тест',
    },
  });
  const supplier = await prisma.supplier.create({
    data: { companyId: company.id, name: 'Поставщик X', debt: opts.debt ?? 0 },
  });
  const product = await prisma.product.create({
    data: {
      companyId: company.id,
      name: 'Бумага A4',
      purchasePrice: opts.purchasePrice ?? 0,
    },
  });
  const shift = opts.withShift
    ? await prisma.cashShift.create({
        data: { companyId: company.id, userId: user.id },
      })
    : null;
  if (opts.stockQty != null) {
    await prisma.stock.create({
      data: { productId: product.id, branchId: branch.id, quantity: opts.stockQty },
    });
  }
  return { company, branch, user, supplier, product, shift };
}

describe('Интеграция (живой Postgres): PurchasingService — гарантии уровня БД', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = makePrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('два конкурентных paySupplierDebt НЕ списывают долг дважды (guard debt>=pay в updateMany)', async () => {
    const { company, user, supplier } = await seedBase(prisma, {
      debt: 100,
      withShift: true,
    });
    const service = new PurchasingService(prisma, new AuditService(prisma));

    // Две ОДНОВРЕМЕННЫЕ оплаты, каждая пытается закрыть весь долг 100.
    // Если бы списание не было атомарным (read-modify-write без guard),
    // оба вызова прочитали бы debt=100 и дважды сняли деньги -> debt=-100.
    const results = await Promise.allSettled([
      service.paySupplierDebt(supplier.id, { amount: 100 }, user.id, company.id),
      service.paySupplierDebt(supplier.id, { amount: 100 }, user.id, company.id),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Ровно одна прошла, ровно одна отклонена (guard debt>=pay -> count=0,
    // либо свежий долг уже 0 -> pay<=0). Обе ветки — BadRequestException.
    expect(ok).toBe(1);
    expect(failed).toBe(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);

    // Инвариант В БД: долг списан РОВНО один раз -> ровно 0 (не -100).
    const fresh = await prisma.supplier.findUnique({ where: { id: supplier.id } });
    expect(Number(fresh!.debt)).toBe(0);
    // Ровно одна запись оплаты поставщику и ровно один расход из кассы.
    expect(
      await prisma.supplierPayment.count({ where: { supplierId: supplier.id } }),
    ).toBe(1);
    expect(
      await prisma.cashMovement.count({ where: { companyId: company.id, type: 'OUT' } }),
    ).toBe(1);
  });

  it('ОТКАТ createReceipt при сбое аудита: приёмка, движения и остатки НЕ сохраняются', async () => {
    const { company, branch, product } = await seedBase(prisma, {
      purchasePrice: 10, // до приёмки закупочная цена = 10
      stockQty: 5, // до приёмки остаток = 5
    });
    const audit = new AuditService(prisma);
    // Аудит внутри транзакции падает -> Prisma обязана откатить ВСЮ приёмку.
    jest.spyOn(audit, 'recordTx').mockRejectedValue(new Error('boom: audit down'));
    const service = new PurchasingService(prisma, audit);

    await expect(
      service.createReceipt(
        {
          companyId: company.id,
          branchId: branch.id,
          paidFromCash: false, // без кассы: смена не нужна, причина отката — только аудит
          items: [{ productId: product.id, quantity: 3, cost: 50, salePrice: 120 }],
        } as any,
        undefined,
      ),
    ).rejects.toThrow('boom: audit down');

    // Инвариант В БД: транзакция откатилась целиком — ни одной мутации.
    expect(await prisma.stockReceipt.count({ where: { companyId: company.id } })).toBe(0);
    expect(await prisma.stockReceiptItem.count()).toBe(0);
    expect(await prisma.stockMovement.count({ where: { companyId: company.id } })).toBe(
      0,
    );
    // Остаток на складе не тронут (5, а не 5+3=8) — upsert откатился.
    const stock = await prisma.stock.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: branch.id } },
    });
    expect(Number(stock!.quantity)).toBe(5);
    // Цены товара не перезаписаны приёмкой (закупочная 10, продажная 0).
    const prod = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(prod!.purchasePrice)).toBe(10);
    expect(Number(prod!.salePrice)).toBe(0);
    // Расход кассы не создан (его и не должно было быть при paidFromCash=false).
    expect(await prisma.cashMovement.count({ where: { companyId: company.id } })).toBe(0);
    // Счётчик номера PRIH тоже откатился: nextSeq (INSERT ... ON CONFLICT) шёл в той же tx.
    const counter = await prisma.documentCounter.findUnique({
      where: { companyId_type: { companyId: company.id, type: 'PRIH' } },
    });
    expect(counter).toBeNull();
  });

  it('погашение долга гасит приёмки в порядке даты (FIFO) — сортировку выполняет БД', async () => {
    const { company, branch, user, supplier, product } = await seedBase(prisma, {
      debt: 200,
      withShift: true,
    });

    // НОВУЮ приёмку вставляем ПЕРВОЙ, СТАРУЮ — второй. Если бы порядок брался из
    // порядка вставки / id, FIFO бы нарушился. Сервис сортирует orderBy date asc
    // (это делает сама БД), поэтому первой должна погаситься СТАРАЯ приёмка.
    const receiptNew = await prisma.stockReceipt.create({
      data: {
        companyId: company.id,
        supplierId: supplier.id,
        branchId: branch.id,
        date: new Date('2026-06-01'),
        total: 100,
        paidAmount: 0,
        paymentStatus: ReceiptPaymentStatus.DEBT,
      },
    });
    const receiptOld = await prisma.stockReceipt.create({
      data: {
        companyId: company.id,
        supplierId: supplier.id,
        branchId: branch.id,
        date: new Date('2026-01-01'),
        total: 100,
        paidAmount: 0,
        paymentStatus: ReceiptPaymentStatus.DEBT,
      },
    });
    // Позиции нужны, чтобы приёмки были достоверными приходами товара.
    await prisma.stockReceiptItem.createMany({
      data: [
        { receiptId: receiptNew.id, productId: product.id, quantity: 1, cost: 100 },
        { receiptId: receiptOld.id, productId: product.id, quantity: 1, cost: 100 },
      ],
    });

    const service = new PurchasingService(prisma, new AuditService(prisma));
    // Платим 120: хватает закрыть СТАРУЮ (100) полностью и НОВУЮ (20) частично.
    await service.paySupplierDebt(supplier.id, { amount: 120 }, user.id, company.id);

    const oldAfter = await prisma.stockReceipt.findUnique({
      where: { id: receiptOld.id },
    });
    const newAfter = await prisma.stockReceipt.findUnique({
      where: { id: receiptNew.id },
    });
    // Старая приёмка закрыта полностью (100/100 -> PAID, срок оплаты снят).
    expect(Number(oldAfter!.paidAmount)).toBe(100);
    expect(oldAfter!.paymentStatus).toBe(ReceiptPaymentStatus.PAID);
    // Новая — частично (20/100 -> PARTIAL), т.е. оплата дошла до неё во вторую очередь.
    expect(Number(newAfter!.paidAmount)).toBe(20);
    expect(newAfter!.paymentStatus).toBe(ReceiptPaymentStatus.PARTIAL);
    // Долг поставщику уменьшен ровно на 120.
    const s = await prisma.supplier.findUnique({ where: { id: supplier.id } });
    expect(Number(s!.debt)).toBe(80);
  });
});
