-- Multi-tenant isolation: every User/Customer/Vehicle/Job/Invoice belongs to a
-- Workshop (ON DELETE RESTRICT — deleting a workshop must never orphan or drop
-- transaction audit trails). Existing rows are backfilled to the active
-- (fallback: oldest) workshop, matching WorkshopsService.activeRow().

ALTER TABLE "User" ADD COLUMN "workshopId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "workshopId" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "workshopId" TEXT;
ALTER TABLE "Job" ADD COLUMN "workshopId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "workshopId" TEXT;

DO $$
DECLARE ws TEXT;
BEGIN
  SELECT id INTO ws FROM "Workshop" ORDER BY active DESC, "createdAt" ASC LIMIT 1;
  IF ws IS NOT NULL THEN
    UPDATE "User" SET "workshopId" = ws WHERE "workshopId" IS NULL;
    UPDATE "Customer" SET "workshopId" = ws WHERE "workshopId" IS NULL;
    UPDATE "Vehicle" SET "workshopId" = ws WHERE "workshopId" IS NULL;
    UPDATE "Job" SET "workshopId" = ws WHERE "workshopId" IS NULL;
    UPDATE "Invoice" SET "workshopId" = ws WHERE "workshopId" IS NULL;
  END IF;
END $$;

ALTER TABLE "User" ALTER COLUMN "workshopId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "workshopId" SET NOT NULL;
ALTER TABLE "Vehicle" ALTER COLUMN "workshopId" SET NOT NULL;
ALTER TABLE "Job" ALTER COLUMN "workshopId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "workshopId" SET NOT NULL;

CREATE INDEX "User_workshopId_idx" ON "User"("workshopId");
CREATE INDEX "Customer_workshopId_idx" ON "Customer"("workshopId");
CREATE INDEX "Vehicle_workshopId_idx" ON "Vehicle"("workshopId");
CREATE INDEX "Job_workshopId_idx" ON "Job"("workshopId");
CREATE INDEX "Invoice_workshopId_idx" ON "Invoice"("workshopId");

ALTER TABLE "User" ADD CONSTRAINT "User_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keyset pagination fix: random UUID `id` can't tie-break a cursor. Replace
-- (jobId, createdAt, id) with a monotonic insert sequence. Existing rows are
-- numbered in (createdAt, id) order so history keeps its feed order.
ALTER TABLE "JobCardEvent" ADD COLUMN "sequenceNumber" SERIAL NOT NULL;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "JobCardEvent"
)
UPDATE "JobCardEvent" e SET "sequenceNumber" = o.rn FROM ordered o WHERE e.id = o.id;

SELECT setval(
  pg_get_serial_sequence('"JobCardEvent"', 'sequenceNumber'),
  COALESCE((SELECT MAX("sequenceNumber") FROM "JobCardEvent"), 0) + 1,
  false
);

DROP INDEX "JobCardEvent_jobId_createdAt_id_idx";
CREATE UNIQUE INDEX "JobCardEvent_sequenceNumber_key" ON "JobCardEvent"("sequenceNumber");
CREATE INDEX "JobCardEvent_jobId_sequenceNumber_idx" ON "JobCardEvent"("jobId", "sequenceNumber");
