-- Company-scope для alias-штрихкодов + soft-delete-совместимая уникальность.
-- Раньше ProductBarcodeAlias.barcode имел ГЛОБАЛЬНЫЙ @unique — штрихкод одной
-- компании блокировал такой же у другой (нарушение изоляции арендаторов, cross-tenant P2002),
-- а soft-deleted alias навечно резервировал код. Исправляем:
--   1) добавляем companyId (backfill из Product), FK, индекс;
--   2) снимаем глобальный unique;
--   3) ставим ЧАСТИЧНЫЙ unique (companyId, barcode) WHERE deletedAt IS NULL.

-- 1. Снимаем глобальный уникальный индекс на barcode.
DROP INDEX IF EXISTS "ProductBarcodeAlias_barcode_key";

-- 2. Добавляем companyId (сначала nullable — таблица может быть непустой).
ALTER TABLE "ProductBarcodeAlias" ADD COLUMN "companyId" TEXT;

-- 3. Backfill: companyId берём у связанного товара.
UPDATE "ProductBarcodeAlias" a
SET "companyId" = p."companyId"
FROM "Product" p
WHERE a."productId" = p."id" AND a."companyId" IS NULL;

-- 4. Теперь колонка обязательна.
ALTER TABLE "ProductBarcodeAlias" ALTER COLUMN "companyId" SET NOT NULL;

-- 5. Индекс + внешний ключ.
CREATE INDEX "ProductBarcodeAlias_companyId_idx" ON "ProductBarcodeAlias"("companyId");
ALTER TABLE "ProductBarcodeAlias" ADD CONSTRAINT "ProductBarcodeAlias_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Частичный уникальный индекс (company-scoped, игнорирует soft-delete) — сырой SQL,
--    Prisma такие индексы не выражает в схеме и не трогает при migrate.
--    Пустые/NULL штрихкоды не ограничиваем.
CREATE UNIQUE INDEX IF NOT EXISTS "ProductBarcodeAlias_companyId_barcode_active_key"
  ON "ProductBarcodeAlias" ("companyId", "barcode")
  WHERE "barcode" IS NOT NULL AND "barcode" <> '' AND "deletedAt" IS NULL;
