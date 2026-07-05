-- AlterTable: идемпотентность возврата (P0-7)
ALTER TABLE "Return" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex: уникальный ключ (NULL допускает множество — обычные возвраты без ключа не конфликтуют)
CREATE UNIQUE INDEX "Return_idempotencyKey_key" ON "Return"("idempotencyKey");
