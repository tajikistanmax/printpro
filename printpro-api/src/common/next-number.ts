import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

type RawCapable = { $queryRaw: (...args: any[]) => Promise<any> };

// Атомарно выдаёт следующий порядковый номер документа для (companyId, type).
// Один SQL-оператор INSERT ... ON CONFLICT DO UPDATE ... RETURNING блокирует
// строку счётчика на время инкремента, поэтому одновременные кассиры/узлы
// никогда не получат одинаковый номер. Можно передавать транзакцию (tx) или
// базовый PrismaService.
export async function nextSeq(
  db: Prisma.TransactionClient | RawCapable,
  companyId: string,
  type: string,
): Promise<number> {
  const rows = (await (db as RawCapable).$queryRaw(
    Prisma.sql`
      INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
      VALUES (${randomUUID()}, ${companyId}, ${type}, 1)
      ON CONFLICT ("companyId", "type")
      DO UPDATE SET "value" = "DocumentCounter"."value" + 1
      RETURNING "value"
    `,
  )) as Array<{ value: number }>;
  return Number(rows[0].value);
}
