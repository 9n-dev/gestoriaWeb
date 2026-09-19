-- AlterTable
ALTER TABLE "data_exports" ADD COLUMN "downloadTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "data_exports_downloadTokenHash_key" ON "data_exports"("downloadTokenHash");
