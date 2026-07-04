-- AlterTable
ALTER TABLE "DesignProof" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT;

-- AddForeignKey
ALTER TABLE "DesignProof" ADD CONSTRAINT "DesignProof_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
