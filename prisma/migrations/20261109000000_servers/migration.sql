-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('text', 'voice');

-- CreateEnum
CREATE TYPE "ChannelSendMode" AS ENUM ('everyone', 'managers');

-- CreateEnum
CREATE TYPE "StudyStarter" AS ENUM ('anyone', 'managers');

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconKey" TEXT,
    "ownerId" TEXT NOT NULL,
    "welcomeChannelId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "categoryId" TEXT,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "sendMode" "ChannelSendMode" NOT NULL DEFAULT 'everyone',
    "isStudyRoom" BOOLEAN NOT NULL DEFAULT false,
    "studyStarter" "StudyStarter" NOT NULL DEFAULT 'anyone',
    "studyFocusMinutes" INTEGER NOT NULL DEFAULT 25,
    "studyShortBreakMinutes" INTEGER NOT NULL DEFAULT 5,
    "studyLongBreakMinutes" INTEGER,
    "studyLongBreakEvery" INTEGER,
    "taskBoardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelViewRole" (
    "channelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,

    CONSTRAINT "ChannelViewRole_pkey" PRIMARY KEY ("channelId","roleId")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "permissions" BIGINT NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL,
    "mentionable" BOOLEAN NOT NULL DEFAULT false,
    "isEveryone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeoutUntil" TIMESTAMPTZ(6),
    "timeoutReason" TEXT,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("serverId","userId")
);

-- CreateTable
CREATE TABLE "MemberRole" (
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "MemberRole_pkey" PRIMARY KEY ("serverId","userId","roleId")
);

-- CreateTable
CREATE TABLE "Invite" (
    "code" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "channelId" TEXT,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Ban" (
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "bannedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("serverId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Server_welcomeChannelId_key" ON "Server"("welcomeChannelId");

-- CreateIndex
CREATE INDEX "Server_ownerId_idx" ON "Server"("ownerId");

-- CreateIndex
CREATE INDEX "Server_deletedAt_idx" ON "Server"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_serverId_nameKey_key" ON "Category"("serverId", "nameKey");

-- CreateIndex
-- NULLS NOT DISTINCT (hand-written; Prisma cannot say it): the channels
-- outside any category (categoryId empty) are one group, so two of them of the
-- same kind cannot share a name either (D-84). Without it Postgres treats every
-- empty categoryId as different and lets the clash through.
CREATE UNIQUE INDEX "Channel_serverId_categoryId_type_nameKey_key" ON "Channel"("serverId", "categoryId", "type", "nameKey") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_id_serverId_key" ON "Channel"("id", "serverId");

-- CreateIndex
CREATE INDEX "ChannelViewRole_roleId_idx" ON "ChannelViewRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_serverId_nameKey_key" ON "Role"("serverId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Role_id_serverId_key" ON "Role"("id", "serverId");

-- CreateIndex
CREATE INDEX "Member_userId_idx" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_serverId_joinedAt_idx" ON "Member"("serverId", "joinedAt");

-- CreateIndex
CREATE INDEX "MemberRole_roleId_idx" ON "MemberRole"("roleId");

-- CreateIndex
CREATE INDEX "Invite_serverId_idx" ON "Invite"("serverId");

-- CreateIndex
CREATE INDEX "Invite_creatorId_idx" ON "Invite"("creatorId");

-- CreateIndex
CREATE INDEX "Invite_channelId_idx" ON "Invite"("channelId");

-- CreateIndex
CREATE INDEX "Ban_serverId_createdAt_idx" ON "Ban"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "Ban_userId_idx" ON "Ban"("userId");

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_welcomeChannelId_fkey" FOREIGN KEY ("welcomeChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelViewRole" ADD CONSTRAINT "ChannelViewRole_channelId_serverId_fkey" FOREIGN KEY ("channelId", "serverId") REFERENCES "Channel"("id", "serverId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelViewRole" ADD CONSTRAINT "ChannelViewRole_roleId_serverId_fkey" FOREIGN KEY ("roleId", "serverId") REFERENCES "Role"("id", "serverId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_serverId_userId_fkey" FOREIGN KEY ("serverId", "userId") REFERENCES "Member"("serverId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_roleId_serverId_fkey" FOREIGN KEY ("roleId", "serverId") REFERENCES "Role"("id", "serverId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written, as Prisma cannot express a partial index: one @everyone role
-- per server.
CREATE UNIQUE INDEX "Role_one_everyone_per_server" ON "Role"("serverId") WHERE "isEveryone";
