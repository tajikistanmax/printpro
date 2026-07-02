-- Частичные уникальные индексы (WHERE) — не выражаются в схеме Prisma,
-- поэтому создаём их сырым SQL. Prisma такие индексы не трогает при migrate.

-- С4: один штрихкод — один активный товар в пределах компании.
-- NULL/пустые штрихкоды не ограничиваем; мягко удалённые товары не мешают
-- переиспользовать штрихкод новым товаром.
CREATE UNIQUE INDEX IF NOT EXISTS "Product_companyId_barcode_active_key"
  ON "Product" ("companyId", "barcode")
  WHERE "barcode" IS NOT NULL AND "barcode" <> '' AND "deletedAt" IS NULL;

-- С13: у кассира не более одной ОТКРЫТОЙ смены в компании одновременно
-- (двойное открытие смены двойным кликом/параллельным запросом невозможно).
CREATE UNIQUE INDEX IF NOT EXISTS "CashShift_companyId_userId_open_key"
  ON "CashShift" ("companyId", "userId")
  WHERE "closedAt" IS NULL AND "deletedAt" IS NULL;
