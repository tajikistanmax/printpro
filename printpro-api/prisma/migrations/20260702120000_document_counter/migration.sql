-- Атомарный счётчик номеров документов (защита от одинаковых номеров при
-- одновременной работе многих кассиров).
CREATE TABLE "DocumentCounter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentCounter_companyId_type_key" ON "DocumentCounter"("companyId", "type");

-- Засеиваем счётчики текущими значениями, чтобы новые номера продолжили ряд,
-- а не столкнулись с уже существующими документами.
INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
SELECT gen_random_uuid()::text, "companyId", 'ORDER', COUNT(*) FROM "Order" GROUP BY "companyId";

INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
SELECT gen_random_uuid()::text, "companyId", 'POS', COUNT(*) FROM "Order" WHERE "receiptNumber" IS NOT NULL GROUP BY "companyId";

INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
SELECT gen_random_uuid()::text, "companyId", 'VOZ', COUNT(*) FROM "Return" GROUP BY "companyId";

INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
SELECT gen_random_uuid()::text, "companyId", 'PRIH', COUNT(*) FROM "StockReceipt" GROUP BY "companyId";

INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
SELECT gen_random_uuid()::text, "companyId", 'SMENA', COUNT(*) FROM "CashShift" GROUP BY "companyId";

INSERT INTO "DocumentCounter" ("id", "companyId", "type", "value")
SELECT gen_random_uuid()::text, "companyId", 'QUOTE', COUNT(*) FROM "Quote" GROUP BY "companyId";
