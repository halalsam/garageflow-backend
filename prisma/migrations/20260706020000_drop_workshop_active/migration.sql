-- `active` was a single global flag for "the workshop the app operates as".
-- Superseded by per-session scoping (JWT workshopId, WorkshopAccess grants).
ALTER TABLE "Workshop" DROP COLUMN "active";
