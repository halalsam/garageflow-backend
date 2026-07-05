-- AlterTable
ALTER TABLE "Workshop" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "gstRate" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "invoiceFooter" TEXT,
ADD COLUMN     "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
ADD COLUMN     "phone" TEXT;
