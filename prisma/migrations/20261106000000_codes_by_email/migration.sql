-- Codes by email (M0, L6): D-59, D-129, D-133.
--
-- 1. Emailed codes are keyed by address and purpose, not by account: a
--    sign-in code goes to an address that may have no account yet. Two
--    purposes remain, sign-in and password-reset. Live codes are dropped:
--    they last ten minutes, and the old purposes no longer exist.
-- 2. No account is "unconfirmed" any more. The old sign-ups that never
--    confirmed their address (they have a password, and never proved they
--    read the inbox) are deleted, as the old sweep would have. Accounts
--    without a password are kept: they predate this module and sign in with
--    a code, which proves the address.
-- 3. completedAt marks the "complete your account" step done. Accounts that
--    already chose a username had the old equivalent and count as completed;
--    any other account goes through the step at its next sign-in.

-- 1
DELETE FROM "VerificationCode";

ALTER TABLE "VerificationCode" DROP CONSTRAINT "VerificationCode_userId_fkey";

DROP INDEX "VerificationCode_userId_purpose_key";

ALTER TABLE "VerificationCode" DROP COLUMN "userId",
ADD COLUMN     "email" TEXT NOT NULL;

CREATE UNIQUE INDEX "VerificationCode_email_purpose_key" ON "VerificationCode"("email", "purpose");

-- 2
DELETE FROM "User" u
WHERE u."emailVerified" = false
  AND EXISTS (SELECT 1 FROM "Credential" c WHERE c."userId" = u."id");

DROP INDEX "User_emailVerified_createdAt_idx";

ALTER TABLE "User" DROP COLUMN "emailVerified";

-- 3
ALTER TABLE "User" ADD COLUMN     "completedAt" TIMESTAMPTZ(6);

UPDATE "User" SET "completedAt" = "createdAt" WHERE "hasSetUsername" = true;
