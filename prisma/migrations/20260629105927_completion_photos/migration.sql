-- CreateTable
CREATE TABLE "CompletionPhoto" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompletionPhoto_jobId_side_key" ON "CompletionPhoto"("jobId", "side");

-- AddForeignKey
ALTER TABLE "CompletionPhoto" ADD CONSTRAINT "CompletionPhoto_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
