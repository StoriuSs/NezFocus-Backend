-- The "complete your account" step (M0 L7; D-61, D-128, D-131).

-- A username is now chosen once, in that step, so the flag that guarded
-- "set it only once" has nothing left to guard: an account has a username
-- exactly when it is completed. An account that set one after the L6
-- migration filled completedAt (dev data only) is completed first, as that
-- migration did, so dropping the flag does not send it back to the step.
UPDATE "User" SET "completedAt" = "updatedAt" WHERE "hasSetUsername" AND "completedAt" IS NULL;

ALTER TABLE "User" DROP COLUMN "hasSetUsername",
-- When the owner agreed to the Terms and the Privacy Policy (REQ-AUTH-01).
-- Empty for accounts completed before this step existed.
ADD COLUMN     "termsAcceptedAt" TIMESTAMPTZ(6);

-- What a person chose for themselves (SRS 7.1). Made when the account is
-- completed; an account without a row reads every setting as its default.
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "timezoneChangedAt" TIMESTAMPTZ(6),
    "language" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "phaseSound" BOOLEAN NOT NULL DEFAULT true,
    "browserNotifications" BOOLEAN NOT NULL DEFAULT false,
    "notifyMentions" BOOLEAN NOT NULL DEFAULT true,
    "notifyDirectMessages" BOOLEAN NOT NULL DEFAULT true,
    "notifyIncomingCalls" BOOLEAN NOT NULL DEFAULT true,
    "notifyPhaseChanges" BOOLEAN NOT NULL DEFAULT true,
    "notificationPromptDismissed" BOOLEAN NOT NULL DEFAULT false,
    "allowServerMemberMessages" BOOLEAN NOT NULL DEFAULT true,
    "showStudyActivity" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
