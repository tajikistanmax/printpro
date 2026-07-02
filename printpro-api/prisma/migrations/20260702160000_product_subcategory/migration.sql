-- Подкатегории товаров: самоссылка ProductCategory.parentId → ProductCategory.id
ALTER TABLE "ProductCategory" ADD COLUMN "parentId" TEXT;

CREATE INDEX "ProductCategory_parentId_idx" ON "ProductCategory"("parentId");

ALTER TABLE "ProductCategory"
  ADD CONSTRAINT "ProductCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
