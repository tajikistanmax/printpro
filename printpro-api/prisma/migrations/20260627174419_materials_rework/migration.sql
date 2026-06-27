-- AlterEnum
ALTER TYPE "ProductionStatus" ADD VALUE 'REWORK';

-- AlterTable
ALTER TABLE "ProductionJob" ADD COLUMN     "defectReason" TEXT,
ADD COLUMN     "materialsWrittenOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ServiceMaterial" (
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "syncNode" TEXT,
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyPerUnit" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceMaterial_serviceId_productId_key" ON "ServiceMaterial"("serviceId", "productId");

-- AddForeignKey
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT "ServiceMaterial_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT "ServiceMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
