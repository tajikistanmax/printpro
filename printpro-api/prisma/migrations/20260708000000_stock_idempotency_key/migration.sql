-- Идемпотентность stock-мутаций: nullable unique-ключ (двойной сабмит с тем же
-- ключом не задваивает движение/списание). Все существующие значения NULL —
-- Postgres не считает NULL дублями, поэтому unique-индекс ставится безопасно.
ALTER TABLE "StockMovement" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");

ALTER TABLE "WriteOff" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "WriteOff_idempotencyKey_key" ON "WriteOff"("idempotencyKey");
