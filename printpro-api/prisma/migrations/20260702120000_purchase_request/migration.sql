-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "syncNode" TEXT,
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT,
    "supplierName" TEXT,
    "note" TEXT,
    "items" JSONB NOT NULL,
    "totalQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRequest_companyId_idx" ON "PurchaseRequest"("companyId");
