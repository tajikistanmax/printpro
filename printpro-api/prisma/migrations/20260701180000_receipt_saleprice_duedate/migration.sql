-- AlterTable
ALTER TABLE "StockReceipt" ADD COLUMN     "dueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockReceiptItem" ADD COLUMN     "salePrice" DECIMAL(12,2);
