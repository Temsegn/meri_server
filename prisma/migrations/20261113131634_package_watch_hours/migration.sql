-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "watchHours" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "watchHours" INTEGER NOT NULL DEFAULT 0;
