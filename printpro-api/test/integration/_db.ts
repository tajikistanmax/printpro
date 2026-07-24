// Общие помощники интеграционных тестов на живом Postgres.
import { PrismaService } from '../../src/prisma/prisma.service';

/** Новый экземпляр PrismaService, подключённый к тестовой БД (env из _env.ts). */
export function makePrisma(): PrismaService {
  return new PrismaService();
}

/**
 * Полная очистка данных между тестами: TRUNCATE всех таблиц public
 * (кроме _prisma_migrations) c RESTART IDENTITY CASCADE. Даёт каждому тесту
 * чистый лист и снимает проблему порядка удаления по внешним ключам.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (!rows.length) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
