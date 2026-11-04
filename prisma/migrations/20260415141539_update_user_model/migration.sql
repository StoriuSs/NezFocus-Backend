-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
