-- Чистим существующие дубли штрихкодов: если у нескольких активных товаров
-- один и тот же штрихкод, оставляем его только у самого «старого» (min id),
-- у остальных обнуляем. Дальше уникальность держит валидация в сервисе.
UPDATE "Product" p
SET "barcode" = NULL
WHERE p."deletedAt" IS NULL
  AND p."barcode" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Product" q
    WHERE q."companyId" = p."companyId"
      AND q."barcode" = p."barcode"
      AND q."deletedAt" IS NULL
      AND q."id" < p."id"
  );
