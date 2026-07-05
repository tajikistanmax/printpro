-- AlterTable: сколько из возврата выдано наличными — чтобы серия возвратов
-- не выдала кэшем больше, чем реально получено (P0-2).
ALTER TABLE "Return" ADD COLUMN "cashRefunded" DECIMAL(12,2) NOT NULL DEFAULT 0;
