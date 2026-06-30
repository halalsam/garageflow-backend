-- CreateEnum
CREATE TYPE "JobEventType" AS ENUM ('COMMENT', 'STATUS_CHANGE', 'PART_ADDED', 'PHOTO', 'APPROVAL', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "JobTimelineEntry" DROP CONSTRAINT "JobTimelineEntry_jobId_fkey";

-- DropForeignKey
ALTER TABLE "JobTimelineEntry" DROP CONSTRAINT "JobTimelineEntry_authorId_fkey";

-- DropTable
DROP TABLE "JobTimelineEntry";

-- DropEnum
DROP TYPE "TimelineKind";

-- CreateTable
CREATE TABLE "JobCardEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "authorId" TEXT,
    "type" "JobEventType" NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobCardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobCardEvent_jobId_createdAt_id_idx" ON "JobCardEvent"("jobId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "JobCardEvent_clientId_idx" ON "JobCardEvent"("clientId");

-- AddForeignKey
ALTER TABLE "JobCardEvent" ADD CONSTRAINT "JobCardEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCardEvent" ADD CONSTRAINT "JobCardEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

