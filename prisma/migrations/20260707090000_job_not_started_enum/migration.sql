-- Add the NOT_STARTED status. Kept in its own migration: Postgres cannot use a
-- newly added enum value inside the transaction that adds it, so the default /
-- backfill live in the follow-up migration.
ALTER TYPE "JobStatus" ADD VALUE 'NOT_STARTED' BEFORE 'IN_PROGRESS';
