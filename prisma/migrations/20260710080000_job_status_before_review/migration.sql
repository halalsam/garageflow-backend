-- Remember the status a job held before the estimate flow parked it in REVIEW,
-- so a decision can restore it exactly (AWAITING_PART / COMPLETED included).
ALTER TABLE "Job" ADD COLUMN "statusBeforeReview" "JobStatus";

-- Backfill jobs currently parked in REVIEW using the old restore heuristic.
UPDATE "Job"
SET "statusBeforeReview" = CASE
  WHEN "startedAt" IS NOT NULL THEN 'IN_PROGRESS'::"JobStatus"
  ELSE 'NOT_STARTED'::"JobStatus"
END
WHERE "status" = 'REVIEW';
