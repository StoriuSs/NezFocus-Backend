-- The sign-in session whose join token made each voice connection (D-214):
-- that session ending puts the connection out. Null for connections from
-- before the token carried it; they leave as before, when the browser does.
ALTER TABLE "VoiceState" ADD COLUMN     "sessionId" TEXT;

-- The connections of sessions just ended (SessionsEndedEvent).
CREATE INDEX "VoiceState_sessionId_idx" ON "VoiceState"("sessionId");
