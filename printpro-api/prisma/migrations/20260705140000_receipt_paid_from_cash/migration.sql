-- AlterTable: источник оплаты приёмки — из кассы или из другого источника
-- (галочка «Оплата из кассы»). По умолчанию true = историческое поведение.
ALTER TABLE "StockReceipt" ADD COLUMN "paidFromCash" BOOLEAN NOT NULL DEFAULT true;
