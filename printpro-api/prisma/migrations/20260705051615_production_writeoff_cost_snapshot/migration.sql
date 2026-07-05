-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "productionJobId" TEXT,
ADD COLUMN     "totalCost" DECIMAL(12,4),
ADD COLUMN     "unitCost" DECIMAL(12,4);

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productionJobId_fkey" FOREIGN KEY ("productionJobId") REFERENCES "ProductionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
