-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'REPAIR', 'OFF');

-- AlterTable
ALTER TABLE "ProductionJob" ADD COLUMN     "equipmentId" TEXT;

-- CreateTable
CREATE TABLE "Equipment" (
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "syncNode" TEXT,
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Equipment_companyId_idx" ON "Equipment"("companyId");

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
