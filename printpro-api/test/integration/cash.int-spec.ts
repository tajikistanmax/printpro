import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CashService } from '../../src/cash/cash.service';
import { AuditService } from '../../src/audit/audit.service';
import { makePrisma, truncateAll } from './_db';

/**
 * РЕАЛЬНЫЕ интеграционные тесты CashService на ЖИВОМ Postgres.
 * Доказывают гарантии УРОВНЯ БД, которые unit-моки проверить не могут — это
 * ровно те пункты, что помечены it.todo в src/cash/cash.service.spec.ts:
 *
 *  (1) реальный ЧАСТИЧНЫЙ уникальный индекс «одна открытая смена на кассира»
 *      CashShift_companyId_userId_open_key (ON (companyId,userId) WHERE
 *      closedAt IS NULL AND deletedAt IS NULL) отклоняет вторую вставку (P2002)
 *      даже под гонкой, и откатывает проигравшую транзакцию;
 *  (2) две реально конкурентные closeShift сериализуются на строке в БД —
 *      ровно один closingBalance/Z-аудит (сверх app-level guard по count);
 *  (3) откат Prisma-транзакции: если аудит падает ВНУТРИ транзакции,
 *      смена/движение не сохраняются («нет движения денег без следа»).
 *
 * Сервис поднимается с НАСТОЯЩИМИ PrismaService (makePrisma) и AuditService;
 * для проверки отката подставляется аудит-заглушка, чей recordTx кидает.
 */

// ── seed-хелперы: минимальный валидный граф компания → пользователь ──
async function seedCompany(prisma: PrismaService): Promise<string> {
  const c = await prisma.company.create({ data: { name: 'Тест-Компания' } });
  return c.id;
}

async function seedUser(
  prisma: PrismaService,
  companyId: string,
): Promise<string> {
  const u = await prisma.user.create({
    data: {
      companyId,
      login: `cashier-${randomUUID()}`,
      passwordHash: 'x',
      fullName: 'Кассир Тест',
    },
  });
  return u.id;
}

// Аудит, который ГАРАНТИРОВАННО падает внутри транзакции: сервис вызывает только
// recordTx(tx, …), а он должен уронить всю бизнес-операцию (откат — не глушится).
function throwingAudit(): AuditService {
  return {
    recordTx: jest.fn(async () => {
      throw new Error('audit failure (forced)');
    }),
    record: jest.fn(async () => {}),
  } as unknown as AuditService;
}

describe('Интеграция (живой Postgres): CashService — гарантии уровня БД', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  let service: CashService;

  beforeAll(async () => {
    prisma = makePrisma();
    await prisma.$connect();
    audit = new AuditService(prisma);
    service = new CashService(prisma, audit);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  // ───────── (1) частичный уникальный индекс: одна открытая смена на кассира ─────────
  describe('openShift / партиал-уникальный индекс открытой смены', () => {
    it('DB-инвариант: две КОНКУРЕНТНЫЕ вставки открытой смены того же кассира — вторую отклоняет индекс (P2002)', async () => {
      const companyId = await seedCompany(prisma);
      const userId = await seedUser(prisma, companyId);

      // closedAt по умолчанию NULL → обе строки попадают в частичный индекс.
      const createOpen = (n: number) =>
        prisma.cashShift.create({
          data: {
            companyId,
            userId,
            number: `SMENA-T-${n}`,
            openingBalance: 0,
          },
        });

      const results = await Promise.allSettled([createOpen(1), createOpen(2)]);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected');

      // Ровно одна прошла, ровно одна отклонена — именно нарушением уникальности.
      expect(ok).toBe(1);
      expect(failed).toHaveLength(1);
      const err = (failed[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(err.code).toBe('P2002');

      // В БД — ровно одна открытая смена этого кассира.
      const openCnt = await prisma.cashShift.count({
        where: { companyId, userId, closedAt: null, deletedAt: null },
      });
      expect(openCnt).toBe(1);
    });

    it('через сервис: две КОНКУРЕНТНЫЕ openShift → ровно одна смена, вторая → BadRequest, в БД одна строка', async () => {
      const companyId = await seedCompany(prisma);
      const userId = await seedUser(prisma, companyId);

      // Обе проходят пред-проверку (открытой смены ещё нет) и упираются в индекс
      // на этапе create — сервис ловит P2002 и отдаёт BadRequest.
      const results = await Promise.allSettled([
        service.openShift(companyId, userId, {}),
        service.openShift(companyId, userId, {}),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        BadRequestException,
      );

      // РОВНО одна строка в БД — транзакция проигравшей openShift откатилась
      // целиком, «мусорной» полу-вставленной смены не осталось.
      const total = await prisma.cashShift.count({
        where: { companyId, userId },
      });
      expect(total).toBe(1);
      const open = await prisma.cashShift.count({
        where: { companyId, userId, closedAt: null, deletedAt: null },
      });
      expect(open).toBe(1);
    });

    it('индекс частичный: после закрытия смены разрешает открыть НОВУЮ (WHERE closedAt IS NULL)', async () => {
      const companyId = await seedCompany(prisma);
      const userId = await seedUser(prisma, companyId);

      const first = await service.openShift(companyId, userId, {});
      await service.closeShift(companyId, userId, first.id, {});
      // Закрытая смена вышла из-под частичного индекса → вторая открывается штатно.
      const second = await service.openShift(companyId, userId, {});
      expect(second.id).not.toBe(first.id);

      const open = await prisma.cashShift.count({
        where: { companyId, userId, closedAt: null, deletedAt: null },
      });
      expect(open).toBe(1);
    });
  });

  // ───────── (2) конкурентное закрытие смены сериализуется на строке ─────────
  describe('closeShift — сериализация конкурентного закрытия', () => {
    it('две КОНКУРЕНТНЫЕ closeShift → ровно один успех + один closingBalance + один Z-аудит', async () => {
      const companyId = await seedCompany(prisma);
      const userId = await seedUser(prisma, companyId);
      const shift = await prisma.cashShift.create({
        data: {
          companyId,
          userId,
          number: 'SMENA-T-CLOSE',
          openingBalance: 0,
        },
      });
      // Одна наличная оплата 100 → ожидаемая касса 100 (closingBalance по умолчанию).
      await prisma.payment.create({
        data: { companyId, shiftId: shift.id, amount: 100, method: 'CASH' },
      });

      const results = await Promise.allSettled([
        service.closeShift(companyId, userId, shift.id, {}),
        service.closeShift(companyId, userId, shift.id, {}),
      ]);

      // Ровно одна закрыла смену; вторая на updateMany получила count 0 → BadRequest.
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        BadRequestException,
      );

      // Смена закрыта РОВНО один раз: closedAt выставлен, closingBalance = 100.
      const row = await prisma.cashShift.findUniqueOrThrow({
        where: { id: shift.id },
      });
      expect(row.closedAt).not.toBeNull();
      expect(Number(row.closingBalance)).toBe(100);

      // Z-аудит закрытия ровно один — конкурентный прогон не продублировал след.
      const closeAudits = await prisma.auditLog.count({
        where: { action: 'money:shift-close', entityId: shift.id },
      });
      expect(closeAudits).toBe(1);
    });
  });

  // ───────── (3) откат Prisma-транзакции при сбое аудита ─────────
  describe('откат транзакции при сбое аудита (нет движения денег без следа)', () => {
    it('openShift: аудит падает ВНУТРИ транзакции → смена НЕ сохраняется, аудита нет', async () => {
      const companyId = await seedCompany(prisma);
      const userId = await seedUser(prisma, companyId);
      const svc = new CashService(prisma, throwingAudit());

      await expect(svc.openShift(companyId, userId, {})).rejects.toThrow(
        'audit failure (forced)',
      );

      // create смены был внутри той же транзакции, что и упавший аудит → откат.
      const shifts = await prisma.cashShift.count({
        where: { companyId, userId },
      });
      expect(shifts).toBe(0);
      const audits = await prisma.auditLog.count({ where: { companyId } });
      expect(audits).toBe(0);
    });

    it('addMovement: аудит падает ВНУТРИ транзакции → движение НЕ сохраняется (смена цела)', async () => {
      const companyId = await seedCompany(prisma);
      const userId = await seedUser(prisma, companyId);
      const shift = await prisma.cashShift.create({
        data: {
          companyId,
          userId,
          number: 'SMENA-T-MV',
          openingBalance: 0,
        },
      });
      const svc = new CashService(prisma, throwingAudit());

      await expect(
        svc.addMovement(companyId, userId, {
          type: 'IN',
          amount: 100,
          shiftId: shift.id,
        }),
      ).rejects.toThrow('audit failure (forced)');

      // Движение откатилось вместе с транзакцией…
      const moves = await prisma.cashMovement.count({
        where: { shiftId: shift.id },
      });
      expect(moves).toBe(0);
      // …а сама смена (создана вне падающей транзакции) осталась открытой.
      const still = await prisma.cashShift.findUniqueOrThrow({
        where: { id: shift.id },
      });
      expect(still.closedAt).toBeNull();
    });
  });
});
