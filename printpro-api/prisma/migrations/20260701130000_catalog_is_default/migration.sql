-- AlterTable
ALTER TABLE "ProductCategory" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServiceCategory" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;
