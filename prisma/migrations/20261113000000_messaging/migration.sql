-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('regular', 'system');

-- CreateEnum
CREATE TYPE "SystemEvent" AS ENUM ('member_joined', 'message_pinned');

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "presence" TEXT NOT NULL DEFAULT 'online';

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    "type" "MessageType" NOT NULL DEFAULT 'regular',
    "systemEvent" "SystemEvent",
    "systemData" JSONB,
    "content" TEXT NOT NULL DEFAULT '',
    "nonce" TEXT,
    "replyToId" TEXT,
    "mentionEveryone" BOOLEAN NOT NULL DEFAULT false,
    "mentionHereUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mentionRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "messageId" TEXT,
    "position" INTEGER,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "messageId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("messageId","emoji","userId")
);

-- CreateTable
CREATE TABLE "Pin" (
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "pinnedById" TEXT,
    "pinnedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pin_pkey" PRIMARY KEY ("channelId","messageId")
);

-- CreateTable
CREATE TABLE "ReadState" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReadState_pkey" PRIMARY KEY ("userId","channelId")
);

-- CreateTable
CREATE TABLE "MessageMention" (
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateIndex
CREATE INDEX "Message_authorId_id_idx" ON "Message"("authorId", "id");

-- CreateIndex
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_channelId_id_key" ON "Message"("channelId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Message_authorId_nonce_key" ON "Message"("authorId", "nonce");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_uploaderId_idx" ON "Attachment"("uploaderId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_messageId_position_key" ON "Attachment"("messageId", "position");

-- CreateIndex
CREATE INDEX "Reaction_userId_idx" ON "Reaction"("userId");

-- CreateIndex
CREATE INDEX "Pin_pinnedById_idx" ON "Pin"("pinnedById");

-- CreateIndex
CREATE INDEX "ReadState_channelId_idx" ON "ReadState"("channelId");

-- CreateIndex
CREATE INDEX "MessageMention_userId_channelId_messageId_idx" ON "MessageMention"("userId", "channelId", "messageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_channelId_messageId_fkey" FOREIGN KEY ("channelId", "messageId") REFERENCES "Message"("channelId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadState" ADD CONSTRAINT "ReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadState" ADD CONSTRAINT "ReadState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_channelId_messageId_fkey" FOREIGN KEY ("channelId", "messageId") REFERENCES "Message"("channelId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written, as Prisma cannot express checks or partial indexes.

-- A system message has an event and no author; a regular one has an author
-- and no event (D-168). Only a regular message carries a nonce.
ALTER TABLE "Message" ADD CONSTRAINT "Message_type_check" CHECK (
    ("type" = 'system') = ("systemEvent" IS NOT NULL)
    AND ("type" = 'system') = ("authorId" IS NULL)
    AND ("type" = 'regular' OR "nonce" IS NULL)
);

-- At most 10 files a message (REQ-MSG-04); an image has both sizes or none.
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_shape_check" CHECK (
    ("position" IS NULL OR "position" BETWEEN 0 AND 9)
    AND ("width" IS NULL) = ("height" IS NULL)
);

-- The clean-up finds files never sent, or left by a deleted message, once
-- uploaded more than 24 hours ago (REQ-MSG-04), without reading the
-- attachments that are in use.
CREATE INDEX "Attachment_unattached_createdAt_idx" ON "Attachment"("createdAt") WHERE "messageId" IS NULL;

-- The mention count reads the messages of a channel after the last one read
-- that mention many people at once (@everyone, @here, @role; D-164). Only
-- those messages are in this index, so a channel left unread for a long time
-- is not read message by message. A query uses it only when it repeats this
-- condition word for word.
CREATE INDEX "Message_broad_mentions_idx" ON "Message"("channelId", "id") WHERE "mentionEveryone" OR "mentionHereUserIds" <> '{}' OR "mentionRoleIds" <> '{}';
