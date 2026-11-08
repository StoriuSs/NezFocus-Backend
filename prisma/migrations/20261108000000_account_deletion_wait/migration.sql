-- Deleting an account waits 14 days (M0 L14; REQ-AUTH-09, D-141).
--
-- Asking to delete only records when it was asked: the account stays live,
-- so its address and username stay taken and signing in finds it, to restore
-- it. The sweep deletes it once the 14 days are over. The index serves that
-- sweep.
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt" TIMESTAMPTZ(6);

CREATE INDEX "User_deletionRequestedAt_idx" ON "User"("deletionRequestedAt");
