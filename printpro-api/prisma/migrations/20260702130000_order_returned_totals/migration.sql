-- Возвраты отдельной строкой: заказ остаётся «валовым», а возвращённое копится
-- в отдельных полях (контр-выручка и её себестоимость).
ALTER TABLE "Order" ADD COLUMN     "returnedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN     "returnedCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
