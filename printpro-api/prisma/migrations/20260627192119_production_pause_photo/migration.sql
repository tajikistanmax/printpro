-- AlterEnum
ALTER TYPE "ProductionStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "ProductionJob" ADD COLUMN     "resultPhotoUrl" TEXT;
