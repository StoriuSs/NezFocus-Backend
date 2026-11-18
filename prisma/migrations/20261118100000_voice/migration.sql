-- Who is in which voice room now (prisma/models/voice.prisma, D-210).

-- CreateTable
CREATE TABLE "VoiceState" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "participantSid" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL,
    "micOn" BOOLEAN NOT NULL DEFAULT false,
    "cameraOn" BOOLEAN NOT NULL DEFAULT false,
    "screenSharing" BOOLEAN NOT NULL DEFAULT false,
    "modMuted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "VoiceState_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "VoiceState_channelId_joinedAt_idx" ON "VoiceState"("channelId", "joinedAt");

-- AddForeignKey
ALTER TABLE "VoiceState" ADD CONSTRAINT "VoiceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceState" ADD CONSTRAINT "VoiceState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One person shares a screen per room at most (D-101). The webhook of a
-- second share is refused in the code; this keeps two rows from ever saying
-- so. Prisma cannot express a partial index, so it is written here.
CREATE UNIQUE INDEX "VoiceState_one_screen_share_per_room" ON "VoiceState"("channelId") WHERE "screenSharing";
