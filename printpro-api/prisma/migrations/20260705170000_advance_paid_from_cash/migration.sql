-- AlterTable: источник выдачи аванса — из кассы или из другого источника.
-- По умолчанию true = историческое поведение (наличными из кассы).
ALTER TABLE "SalaryAdvance" ADD COLUMN "paidFromCash" BOOLEAN NOT NULL DEFAULT true;
