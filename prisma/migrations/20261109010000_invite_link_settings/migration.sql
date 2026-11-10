-- A target channel rides on the invite link as ?channel=, not in the invite (D-150).
ALTER TABLE "Invite" DROP CONSTRAINT "Invite_channelId_fkey";
DROP INDEX "Invite_channelId_idx";
ALTER TABLE "Invite" DROP COLUMN "channelId";

-- The lifetime chosen, to tell whether a link may be handed out again (D-151).
ALTER TABLE "Invite" ADD COLUMN "maxAgeSeconds" INTEGER;

-- The invites page lists a server's invites newest first.
DROP INDEX "Invite_serverId_idx";
CREATE INDEX "Invite_serverId_createdAt_idx" ON "Invite"("serverId", "createdAt");
