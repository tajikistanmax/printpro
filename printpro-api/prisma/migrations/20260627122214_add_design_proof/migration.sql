-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'SENT', 'REVISION', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "DesignProof" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "title" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ProofStatus" NOT NULL DEFAULT 'TODO',
    "fileUrl" TEXT,
    "fileName" TEXT,
    "comment" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignProof_companyId_status_idx" ON "DesignProof"("companyId", "status");

-- AddForeignKey
ALTER TABLE "DesignProof" ADD CONSTRAINT "DesignProof_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignProof" ADD CONSTRAINT "DesignProof_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
