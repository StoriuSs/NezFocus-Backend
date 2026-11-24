-- The sign-in session whose join token made each call connection (D-214,
-- D-242): that session ending puts the connection out of the call's room.
-- Null for a token without it.
ALTER TABLE "CallParticipant" ADD COLUMN     "sessionId" TEXT;

-- The connections of sessions just ended (SessionsEndedEvent).
CREATE INDEX "CallParticipant_sessionId_idx" ON "CallParticipant"("sessionId");
