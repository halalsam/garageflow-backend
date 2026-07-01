-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveredById" TEXT,
ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "deliveryNoteAudioUrl" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "photoUrl" TEXT;

-- CreateTable
CREATE TABLE "DeliveryPhoto" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPhoto_jobId_side_key" ON "DeliveryPhoto"("jobId", "side");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPhoto" ADD CONSTRAINT "DeliveryPhoto_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
