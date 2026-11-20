-- A study room's cycle (REQ-STUDY-01, SRS 2): whole minutes of focus 5-120
-- and short break 1-30; a long break of 5-60 after every 2-8 focus phases,
-- both halves set or neither. Every row so far has the defaults (25/5, no long
-- break). The rule lives in servers/domain/study-room.rules.ts; Prisma cannot
-- express this.
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_study_cycle_check" CHECK (
    "studyFocusMinutes" BETWEEN 5 AND 120
    AND "studyShortBreakMinutes" BETWEEN 1 AND 30
    AND ("studyLongBreakMinutes" IS NULL) = ("studyLongBreakEvery" IS NULL)
    AND ("studyLongBreakMinutes" IS NULL OR "studyLongBreakMinutes" BETWEEN 5 AND 60)
    AND ("studyLongBreakEvery" IS NULL OR "studyLongBreakEvery" BETWEEN 2 AND 8)
);
