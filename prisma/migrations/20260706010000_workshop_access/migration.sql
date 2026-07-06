-- Explicit grants letting a user switch their session into a workshop that
-- isn't their home (see POST /workshops/:id/switch). A user's own
-- `workshopId` is always implicitly accessible without a row here.
CREATE TABLE "WorkshopAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkshopAccess_userId_workshopId_key" ON "WorkshopAccess"("userId", "workshopId");

ALTER TABLE "WorkshopAccess" ADD CONSTRAINT "WorkshopAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopAccess" ADD CONSTRAINT "WorkshopAccess_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
