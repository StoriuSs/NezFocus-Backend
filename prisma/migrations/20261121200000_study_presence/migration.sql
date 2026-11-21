-- When the last person present left a Room Session's room (D-227): empty 5
-- minutes and the session ends (empty). Cleared when someone comes in.
ALTER TABLE "FocusSession" ADD COLUMN "emptySince" TIMESTAMPTZ(6);

-- A Room Session's alone, and only while not ended: an end clears it.
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_empty_check" CHECK (
    "emptySince" IS NULL OR ("kind" = 'room' AND "status" <> 'ended' AND "emptySince" >= "startedAt")
);

-- The sweep (D-225) finds the rooms empty long enough, and the people away
-- long enough, whose job was lost: only those rows, not the many others.
CREATE INDEX "FocusSession_empty_due" ON "FocusSession"("emptySince") WHERE "emptySince" IS NOT NULL;
CREATE INDEX "Participation_away_due" ON "Participation"("awaySince") WHERE "awaySince" IS NOT NULL;
