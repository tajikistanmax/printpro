-- CreateTable
CREATE TABLE "ProductBarcodeAlias" (
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "syncNode" TEXT,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcodeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductBarcodeAlias_barcode_key" ON "ProductBarcodeAlias"("barcode");

-- CreateIndex
CREATE INDEX "ProductBarcodeAlias_productId_idx" ON "ProductBarcodeAlias"("productId");

-- AddForeignKey
ALTER TABLE "ProductBarcodeAlias" ADD CONSTRAINT "ProductBarcodeAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
