-- Индексы под горячие агрегаты (P0-16). Postgres не индексирует FK автоматически.
-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");
CREATE INDEX "StockMovement_branchId_idx" ON "StockMovement"("branchId");
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");
CREATE INDEX "Order_companyId_clientId_idx" ON "Order"("companyId", "clientId");
