-- Authentication moves into the application.
--
-- keycloakId and identityDeletedAt existed only because the identity lived in
-- Keycloak; the user's own id is the identity now. The auth module's tables
-- (Credential, Session, RefreshToken, VerificationCode) belong to
-- src/modules/auth and cascade with the user row.
--
-- An account from before this migration has no password. It gets one through
-- password reset, which proves the address and marks it verified.

-- Checked before anything changes: a migration that stops halfway leaves
-- the database half-migrated, since the statements below are not all
-- guaranteed to run in one transaction.
--
-- Two live accounts with the same address cannot both be kept under this
-- index, and choosing which one loses its sign-in address is not a decision a
-- migration should make. Stop with a message instead; resolve them by hand
-- (merge the accounts, or soft-delete one) and run the migration again.
DO $$
DECLARE duplicate TEXT;
BEGIN
    SELECT lower(btrim("email")) INTO duplicate FROM "User"
    WHERE "email" IS NOT NULL AND "deletedAt" IS NULL
    GROUP BY lower(btrim("email")) HAVING count(*) > 1 LIMIT 1;
    IF duplicate IS NOT NULL THEN
        RAISE EXCEPTION 'Several live accounts share an email address (for example %). Resolve them before this migration: sign-in addresses must be unique.', duplicate;
    END IF;
END $$;

-- Stored in lower case from now on; the index below compares that way too.
UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" IS NOT NULL;

/*
  Warnings:

  - You are about to drop the column `identityDeletedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `keycloakId` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "User_keycloakId_deletedAt_idx";

-- DropIndex
DROP INDEX "User_keycloakId_idx";

-- DropIndex
DROP INDEX "User_keycloakId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "identityDeletedAt",
DROP COLUMN "keycloakId",
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY['user']::TEXT[];

-- CreateTable
CREATE TABLE "Credential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordUpdatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedReason" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "replacedById" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMPTZ(6),

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCode_userId_purpose_key" ON "VerificationCode"("userId", "purpose");

-- CreateIndex
CREATE INDEX "User_emailVerified_createdAt_idx" ON "User"("emailVerified", "createdAt");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sign-in addresses are unique among live accounts, whatever their case.
--
-- Prisma cannot express a functional, partial index, so this is by hand, like
-- the username one (20260908000000). The application also stores addresses in
-- lower case; this index is the guarantee that holds if a call site forgets.
-- Deleted accounts keep their address until the retention sweep erases it,
-- and must not block the same person registering again meanwhile.
CREATE UNIQUE INDEX "User_email_active_key"
    ON "User" (lower("email"))
    WHERE "deletedAt" IS NULL AND "email" IS NOT NULL;
