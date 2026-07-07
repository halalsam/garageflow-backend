-- Jobs now begin NOT_STARTED; a technician explicitly starts work (→ IN_PROGRESS).
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';

-- First moment a technician moved the job to IN_PROGRESS.
ALTER TABLE "Job" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Backfill: any job that already progressed past creation counts as started.
UPDATE "Job"
SET "startedAt" = "createdAt"
WHERE "status" IN ('IN_PROGRESS', 'AWAITING_PART', 'COMPLETED', 'DELIVERED');
