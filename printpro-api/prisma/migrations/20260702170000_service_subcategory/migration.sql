-- Подкатегории услуг: самоссылка ServiceCategory.parentId → ServiceCategory.id
ALTER TABLE "ServiceCategory" ADD COLUMN "parentId" TEXT;

CREATE INDEX "ServiceCategory_parentId_idx" ON "ServiceCategory"("parentId");

ALTER TABLE "ServiceCategory"
  ADD CONSTRAINT "ServiceCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "ServiceCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
