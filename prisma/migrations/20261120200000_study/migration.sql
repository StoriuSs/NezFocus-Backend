-- Study sessions, the seconds studied each day, streaks (prisma/models/study.prisma,
-- ARCHITECTURE 5, D-216, D-223).

-- CreateEnum
CREATE TYPE "FocusSessionKind" AS ENUM ('room', 'solo');

-- CreateEnum
CREATE TYPE "FocusSessionStatus" AS ENUM ('running', 'paused', 'waiting', 'ended');

-- CreateEnum
CREATE TYPE "FocusPhase" AS ENUM ('focus', 'short_break', 'long_break');

-- CreateEnum
CREATE TYPE "FocusSessionEndReason" AS ENUM ('stopped', 'empty', 'study_disabled', 'channel_deleted', 'expired', 'signed_out', 'joined_room');

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" TEXT NOT NULL,
    "kind" "FocusSessionKind" NOT NULL,
    "serverId" TEXT,
    "channelId" TEXT,
    "hostId" TEXT,
    "userId" TEXT,
    "focusMinutes" INTEGER NOT NULL,
    "shortBreakMinutes" INTEGER NOT NULL,
    "longBreakMinutes" INTEGER,
    "longBreakEvery" INTEGER,
    "status" "FocusSessionStatus" NOT NULL DEFAULT 'running',
    "phase" "FocusPhase" NOT NULL DEFAULT 'focus',
    "phaseIndex" INTEGER NOT NULL DEFAULT 0,
    "phaseStartedAt" TIMESTAMPTZ(6) NOT NULL,
    "phaseEndsAt" TIMESTAMPTZ(6),
    "pausedRemainingMs" INTEGER,
    "waitingUntil" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(6),
    "endedReason" "FocusSessionEndReason",
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusStretch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),

    CONSTRAINT "FocusStretch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL,
    "leftAt" TIMESTAMPTZ(6),
    "awaySince" TIMESTAMPTZ(6),
    "countedUntil" TIMESTAMPTZ(6) NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStudy" (
    "userId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "focusedSeconds" INTEGER NOT NULL DEFAULT 0,
    "roomSeconds" INTEGER NOT NULL DEFAULT 0,
    "soloSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DailyStudy_pkey" PRIMARY KEY ("userId","localDate")
);

-- CreateTable
CREATE TABLE "Streak" (
    "userId" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "longest" INTEGER NOT NULL DEFAULT 0,
    "lastQualifiedDate" DATE,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Streak_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "FocusSession_userId_startedAt_idx" ON "FocusSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "FocusStretch_sessionId_startedAt_idx" ON "FocusStretch"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "Participation_sessionId_idx" ON "Participation"("sessionId");

-- CreateIndex
CREATE INDEX "Participation_userId_joinedAt_idx" ON "Participation"("userId", "joinedAt");

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusStretch" ADD CONSTRAINT "FocusStretch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FocusSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FocusSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStudy" ADD CONSTRAINT "DailyStudy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What Prisma cannot express: the partial unique indexes and the CHECKs that
-- keep each row's shape. The rules live in src/modules/study/domain; these
-- keep a bug from writing what the rules forbid.

-- One session not yet ended per study room (REQ-STUDY-02), one per person for
-- Solo (REQ-STUDY-05). A second start meets these and answers
-- FOCUS_SESSION_ACTIVE.
CREATE UNIQUE INDEX "FocusSession_one_open_per_room" ON "FocusSession"("channelId") WHERE "status" <> 'ended';
CREATE UNIQUE INDEX "FocusSession_one_open_solo_per_person" ON "FocusSession"("userId") WHERE "status" <> 'ended';
-- The sessions running in a person's servers (GET /me/active-rooms): ended
-- ones, nearly every row, are left out.
CREATE INDEX "FocusSession_open_by_server" ON "FocusSession"("serverId") WHERE "status" <> 'ended';

-- A Room Session names its room and server and no person of its own; a Solo
-- names its person and no room, no Host. Only a Solo waits. Each end reason
-- belongs to one kind (stopped to both).
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_kind_check" CHECK (
    (
        "kind" = 'room'
        AND "serverId" IS NOT NULL AND "channelId" IS NOT NULL AND "userId" IS NULL
        AND "status" <> 'waiting'
        AND ("endedReason" IS NULL OR "endedReason" IN ('stopped', 'empty', 'study_disabled', 'channel_deleted'))
    ) OR (
        "kind" = 'solo'
        AND "userId" IS NOT NULL AND "serverId" IS NULL AND "channelId" IS NULL AND "hostId" IS NULL
        AND ("endedReason" IS NULL OR "endedReason" IN ('stopped', 'expired', 'signed_out', 'joined_room'))
    )
);

-- The cycle, in the ranges of a study room's (Channel_study_cycle_check).
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_cycle_check" CHECK (
    "focusMinutes" BETWEEN 5 AND 120
    AND "shortBreakMinutes" BETWEEN 1 AND 30
    AND ("longBreakMinutes" IS NULL) = ("longBreakEvery" IS NULL)
    AND ("longBreakMinutes" IS NULL OR "longBreakMinutes" BETWEEN 5 AND 60)
    AND ("longBreakEvery" IS NULL OR "longBreakEvery" BETWEEN 2 AND 8)
);

-- Each state has its own time and only it (ARCHITECTURE 5.1): running, when
-- the phase ends; paused, what was left of it; waiting, when the wait ends;
-- ended, none of them, and when and why it ended. A comparison with NULL is
-- NULL, which a CHECK lets through: hence the IS NOT NULL before it.
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_status_check" CHECK (
    CASE "status"
        WHEN 'running' THEN "phaseEndsAt" IS NOT NULL AND "pausedRemainingMs" IS NULL AND "waitingUntil" IS NULL
        WHEN 'paused' THEN "phaseEndsAt" IS NULL AND "pausedRemainingMs" IS NOT NULL AND "pausedRemainingMs" >= 0
            AND "waitingUntil" IS NULL
        WHEN 'waiting' THEN "phaseEndsAt" IS NULL AND "pausedRemainingMs" IS NULL AND "waitingUntil" IS NOT NULL
        ELSE "phaseEndsAt" IS NULL AND "pausedRemainingMs" IS NULL AND "waitingUntil" IS NULL
    END
    AND ("status" = 'ended') = ("endedAt" IS NOT NULL)
    AND ("status" = 'ended') = ("endedReason" IS NOT NULL)
    AND ("endedAt" IS NULL OR "endedAt" >= "startedAt")
    AND "version" >= 0
);

-- Focus and break take turns: the focus phases are the even ones. A long
-- break needs a cycle that has one: a phase with no length cannot run. Which
-- break comes is the rules' (a changed cycle moves it), not a CHECK's.
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_phase_check" CHECK (
    "phaseIndex" >= 0
    AND ("phase" = 'focus') = ("phaseIndex" % 2 = 0)
    AND ("phase" <> 'long_break' OR "longBreakMinutes" IS NOT NULL)
);

-- One open stretch per session (D-216), and none ending before it starts.
CREATE UNIQUE INDEX "FocusStretch_one_open_per_session" ON "FocusStretch"("sessionId") WHERE "endedAt" IS NULL;
ALTER TABLE "FocusStretch" ADD CONSTRAINT "FocusStretch_time_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");

-- One open participation per person, whatever the session (D-103, D-223): a
-- person in a Room Session has no Solo, and the other way round, so no second
-- is counted twice.
CREATE UNIQUE INDEX "Participation_one_open_per_person" ON "Participation"("userId") WHERE "leftAt" IS NULL;
-- Away only while open (D-215); every time at or after joining. Nothing is
-- counted past leaving, nor past going away: the time away counts only once
-- the person is back within 3 minutes (REQ-STUDY-04), so a count while away
-- stops at awaySince. A leave reported for a time already counted is taken at
-- countedUntil.
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_time_check" CHECK (
    "countedUntil" >= "joinedAt"
    AND ("leftAt" IS NULL OR "leftAt" >= "countedUntil")
    AND ("awaySince" IS NULL OR ("leftAt" IS NULL AND "awaySince" >= "countedUntil"))
    AND "seconds" >= 0
);

-- focused = room + solo (D-104), and 16 hours a day at most (REQ-STUDY-04).
ALTER TABLE "DailyStudy" ADD CONSTRAINT "DailyStudy_seconds_check" CHECK (
    "roomSeconds" >= 0
    AND "soloSeconds" >= 0
    AND "focusedSeconds" = "roomSeconds" + "soloSeconds"
    AND "focusedSeconds" <= 57600
);

-- The longest run is never shorter than the current one; a run of 0 is a
-- person who never had a day of 15 minutes, and only that.
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_runs_check" CHECK (
    "current" >= 0
    AND "longest" >= "current"
    AND ("current" = 0) = ("lastQualifiedDate" IS NULL)
);
