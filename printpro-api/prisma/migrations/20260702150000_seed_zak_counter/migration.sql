-- Засеять счётчик номеров заявок на закупку (ZAK) из существующих заявок,
-- чтобы после перехода на race-safe нумерацию номера продолжались, а не
-- начинались заново с 1 (идемпотентно — берём максимум).
INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
SELECT "companyId" || '-ZAK', "companyId", 'ZAK', COUNT(*)::int
FROM "PurchaseRequest"
WHERE "deletedAt" IS NULL
GROUP BY "companyId"
ON CONFLICT ("companyId", "type")
DO UPDATE SET "value" = GREATEST("DocumentCounter"."value", EXCLUDED."value");
