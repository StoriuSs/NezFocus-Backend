-- The social module (SRS 4.9, ARCHITECTURE 9, D-242): friendships, blocks,
-- direct message conversations and their calls; a channel may now have no
-- server, for a conversation.

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('pending', 'accepted');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ringing', 'active', 'ended', 'declined', 'missed', 'failed');

-- CreateEnum
CREATE TYPE "CallEndReason" AS ENUM ('no_answer', 'cancelled', 'busy');

-- AlterTable
ALTER TABLE "Channel" ALTER COLUMN "serverId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Relationship" (
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("userLowId","userHighId")
);

-- CreateTable
CREATE TABLE "Block" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "DmChannel" (
    "channelId" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "lowClosedAt" TIMESTAMPTZ(6),
    "highClosedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmChannel_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "dmChannelId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "calleeId" TEXT NOT NULL,
    "video" BOOLEAN NOT NULL DEFAULT false,
    "status" "CallStatus" NOT NULL DEFAULT 'ringing',
    "endReason" "CallEndReason",
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallParticipant" (
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participantSid" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL,
    "leftAt" TIMESTAMPTZ(6),

    CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("callId","userId")
);

-- CreateIndex
CREATE INDEX "Relationship_userHighId_idx" ON "Relationship"("userHighId");

-- CreateIndex
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- CreateIndex
CREATE INDEX "DmChannel_userHighId_idx" ON "DmChannel"("userHighId");

-- CreateIndex
CREATE UNIQUE INDEX "DmChannel_userLowId_userHighId_key" ON "DmChannel"("userLowId", "userHighId");

-- CreateIndex
CREATE INDEX "Call_dmChannelId_id_idx" ON "Call"("dmChannelId", "id");

-- CreateIndex
CREATE INDEX "Call_callerId_idx" ON "Call"("callerId");

-- CreateIndex
CREATE INDEX "Call_calleeId_idx" ON "Call"("calleeId");

-- CreateIndex
CREATE INDEX "CallParticipant_userId_idx" ON "CallParticipant"("userId");

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmChannel" ADD CONSTRAINT "DmChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmChannel" ADD CONSTRAINT "DmChannel_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmChannel" ADD CONSTRAINT "DmChannel_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_dmChannelId_fkey" FOREIGN KEY ("dmChannelId") REFERENCES "DmChannel"("channelId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written, as Prisma cannot express checks or partial indexes.

-- A channel has a server unless it is a conversation, which has nothing a
-- server's channel uses: no category, no name, no place in a list, nothing
-- private, no study room, no Task Board (D-167, D-242).
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_dm_check" CHECK (
    ("type" = 'dm') = ("serverId" IS NULL)
    AND (
        "type" <> 'dm'
        OR (
            "categoryId" IS NULL AND "name" = '' AND "nameKey" = '' AND "position" = 0
            AND NOT "isPrivate" AND "sendMode" = 'everyone'
            AND NOT "isStudyRoom" AND NOT "taskBoardEnabled"
        )
    )
);

-- Names repeat only across servers: the index keeps a server's channels
-- apart and leaves conversations out, which all have the same empty name.
-- Still NULLS NOT DISTINCT, so that "no category" counts as one group
-- (20261109000000_servers).
DROP INDEX "Channel_serverId_categoryId_type_nameKey_key";
CREATE UNIQUE INDEX "Channel_serverId_categoryId_type_nameKey_key" ON "Channel"("serverId", "categoryId", "type", "nameKey") NULLS NOT DISTINCT WHERE "serverId" IS NOT NULL;

-- A pair is stored smaller id first, so it has one row whoever acted. Ids
-- are compared byte by byte, as the application sorts them.
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_pair_check" CHECK (
    "userLowId" COLLATE "C" < "userHighId" COLLATE "C"
    AND "requesterId" IN ("userLowId", "userHighId")
);

-- An accepted friendship has the time it was accepted and no longer the
-- request's message; a request has no such time.
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_status_check" CHECK (
    ("status" = 'accepted') = ("acceptedAt" IS NOT NULL)
    AND ("status" = 'pending' OR "note" IS NULL)
);

-- Nobody blocks themselves.
ALTER TABLE "Block" ADD CONSTRAINT "Block_pair_check" CHECK ("blockerId" <> "blockedId");

ALTER TABLE "DmChannel" ADD CONSTRAINT "DmChannel_pair_check" CHECK (
    "userLowId" COLLATE "C" < "userHighId" COLLATE "C"
);

-- What each status has (ARCHITECTURE 6): a reason only when missed; the
-- time of answering once answered (active, then ended or failed); the end
-- once final.
ALTER TABLE "Call" ADD CONSTRAINT "Call_status_check" CHECK (
    "callerId" <> "calleeId"
    AND ("status" = 'missed') = ("endReason" IS NOT NULL)
    AND ("status" IN ('active', 'ended', 'failed')) = ("acceptedAt" IS NOT NULL)
    AND ("status" IN ('ringing', 'active')) = ("endedAt" IS NULL)
);

-- One open call per conversation (D-242): two people calling each other
-- at once meet in one call.
CREATE UNIQUE INDEX "Call_one_open_per_dm" ON "Call"("dmChannelId") WHERE "status" IN ('ringing', 'active');

-- A person's open calls, made or received: GET /me/call, and whether they
-- are busy when someone calls them (D-242).
CREATE INDEX "Call_open_caller_idx" ON "Call"("callerId") WHERE "status" IN ('ringing', 'active');
CREATE INDEX "Call_open_callee_idx" ON "Call"("calleeId") WHERE "status" IN ('ringing', 'active');

-- Which links each kind of item has (20261117000000_tasks_notifications),
-- now with the three items of M6, which belong to no server: a friend item
-- names only who asked or accepted; a missed call names its caller and the
-- call's call_ended message in the conversation, read with it (D-242).
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_links_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_links_check" CHECK (
    CASE
        WHEN "type" IN ('mention', 'reply')
            THEN "serverId" IS NOT NULL
                AND "messageId" IS NOT NULL AND "channelId" IS NOT NULL AND "taskId" IS NULL
        WHEN "type" IN ('task_assigned', 'task_reminder', 'task_unassigned')
            THEN "serverId" IS NOT NULL
                AND "taskId" IS NOT NULL AND "channelId" IS NOT NULL AND "messageId" IS NULL
        WHEN "type" = 'missed_call'
            THEN "serverId" IS NULL AND "actorId" IS NOT NULL
                AND "messageId" IS NOT NULL AND "channelId" IS NOT NULL AND "taskId" IS NULL
        WHEN "type" IN ('friend_request', 'friend_accepted')
            THEN "serverId" IS NULL AND "actorId" IS NOT NULL
                AND "channelId" IS NULL AND "messageId" IS NULL AND "taskId" IS NULL
        ELSE "serverId" IS NOT NULL
            AND "channelId" IS NULL AND "messageId" IS NULL AND "taskId" IS NULL
    END
    -- A moderation item never names the moderator (REQ-ROLE-04).
    AND ("type" <> 'moderation' OR "actorId" IS NULL)
);
