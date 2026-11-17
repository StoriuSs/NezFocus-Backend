-- Search by a part of the title, without accents (D-97): the trigram index
-- on Task.titleSearch needs this extension, turned on before it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('mention', 'reply', 'task_assigned', 'task_reminder', 'task_unassigned', 'owner_transferred', 'moderation');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'doing', 'done');

-- CreateEnum
CREATE TYPE "TaskEventKind" AS ENUM ('created', 'title_changed', 'description_changed', 'due_changed', 'assignee_added', 'assignee_removed', 'status_changed');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "serverId" TEXT,
    "channelId" TEXT,
    "messageId" TEXT,
    "taskId" TEXT,
    "actorId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleSearch" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "dueAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" "TaskEventKind" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_id_idx" ON "Notification"("userId", "id");

-- CreateIndex
CREATE INDEX "Notification_userId_channelId_messageId_idx" ON "Notification"("userId", "channelId", "messageId");

-- CreateIndex
CREATE INDEX "Notification_channelId_messageId_idx" ON "Notification"("channelId", "messageId");

-- CreateIndex
CREATE INDEX "Notification_channelId_taskId_idx" ON "Notification"("channelId", "taskId");

-- CreateIndex
CREATE INDEX "Notification_serverId_idx" ON "Notification"("serverId");

-- CreateIndex
CREATE INDEX "Notification_actorId_idx" ON "Notification"("actorId");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_messageId_key" ON "Notification"("userId", "messageId");

-- CreateIndex
CREATE INDEX "Task_channelId_status_idx" ON "Task"("channelId", "status");

-- CreateIndex
CREATE INDEX "Task_channelId_completedAt_id_idx" ON "Task"("channelId", "completedAt", "id");

-- CreateIndex
CREATE INDEX "Task_creatorId_status_idx" ON "Task"("creatorId", "status");

-- CreateIndex
CREATE INDEX "Task_titleSearch_idx" ON "Task" USING GIN ("titleSearch" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Task_channelId_id_key" ON "Task"("channelId", "id");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_id_idx" ON "TaskEvent"("taskId", "id");

-- CreateIndex
CREATE INDEX "TaskEvent_actorId_idx" ON "TaskEvent"("actorId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_serverId_fkey" FOREIGN KEY ("channelId", "serverId") REFERENCES "Channel"("id", "serverId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_messageId_fkey" FOREIGN KEY ("channelId", "messageId") REFERENCES "Message"("channelId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_taskId_fkey" FOREIGN KEY ("channelId", "taskId") REFERENCES "Task"("channelId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_channelId_serverId_fkey" FOREIGN KEY ("channelId", "serverId") REFERENCES "Channel"("id", "serverId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written, as Prisma cannot express checks or partial indexes.

-- A done task has the time it was done, an open one has none (ARCHITECTURE 7).
ALTER TABLE "Task" ADD CONSTRAINT "Task_completed_check" CHECK (
    ("status" = 'done') = ("completedAt" IS NOT NULL)
);

-- Which links each kind of item has. A message item names its message and
-- channel, a task item its task and channel, the two server items only the
-- server; all of them name the server.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_links_check" CHECK (
    "serverId" IS NOT NULL
    AND CASE
        WHEN "type" IN ('mention', 'reply')
            THEN "messageId" IS NOT NULL AND "channelId" IS NOT NULL AND "taskId" IS NULL
        WHEN "type" IN ('task_assigned', 'task_reminder', 'task_unassigned')
            THEN "taskId" IS NOT NULL AND "channelId" IS NOT NULL AND "messageId" IS NULL
        ELSE "channelId" IS NULL AND "messageId" IS NULL AND "taskId" IS NULL
    END
    -- A moderation item never names the moderator (REQ-ROLE-04).
    AND ("type" <> 'moderation' OR "actorId" IS NULL)
);

-- The badge counts a person's unread items, and "mark all read" reaches
-- them up to an id, without reading the items already read.
CREATE INDEX "Notification_unread_idx" ON "Notification"("userId", "id") WHERE "readAt" IS NULL;
