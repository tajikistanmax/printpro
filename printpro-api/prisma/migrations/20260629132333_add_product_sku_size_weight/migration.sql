-- AlterTable
ALTER TABLE "DesignProof" ADD COLUMN     "checklist" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "size" TEXT,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "weight" TEXT;
