-- CreateEnum
CREATE TYPE "OrderUrgency" AS ENUM ('NORMAL', 'URGENT', 'EXPRESS');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "colorMode" TEXT,
ADD COLUMN     "designerId" TEXT,
ADD COLUMN     "format" TEXT,
ADD COLUMN     "operatorId" TEXT,
ADD COLUMN     "urgency" "OrderUrgency" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "lineCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "leadTimeMin" INTEGER;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
