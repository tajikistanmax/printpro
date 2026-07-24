import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makePrisma, truncateAll } from './_db';

/**
 * Эталонный интеграционный тест на ЖИВОМ Postgres (база printpro_test).
 * Доказывает, что харнес работает и что гарантии уровня БД реальны —
 * то, что unit-тесты с моками проверить не могут (эти пункты помечались it.todo).
 */
describe('Интеграция (живой Postgres): харнес + гарантии уровня БД', () => {
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

  it('тестовая БД подключена и все миграции применены (>= 49)', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      `SELECT COUNT(*)::int AS c FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(49);
  });

  it('durable replay: UNIQUE(node,nonce) отклоняет ВТОРУЮ конкурентную вставку того же nonce', async () => {
    const node = 'node-A';
    const nonce = 'nonce-xyz';
    const expiresAt = new Date(Date.now() + 60_000);

    const insert = (id: string) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "SyncNonce"(id, node, nonce, "expiresAt") VALUES ($1, $2, $3, $4)`,
        id,
        node,
        nonce,
        expiresAt,
      );

    // Две ОДНОВРЕМЕННЫЕ попытки записать один и тот же (node, nonce).
    const results = await Promise.allSettled([insert(randomUUID()), insert(randomUUID())]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Ровно одна прошла, ровно одна отклонена базой (unique violation) —
    // повтор nonce НЕ проходит даже под гонкой (защита от replay реальна).
    expect(ok).toBe(1);
    expect(failed).toBe(1);

    const cnt = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      `SELECT COUNT(*)::int AS c FROM "SyncNonce" WHERE node = $1 AND nonce = $2`,
      node,
      nonce,
    );
    expect(cnt[0].c).toBe(1);
  });
});
