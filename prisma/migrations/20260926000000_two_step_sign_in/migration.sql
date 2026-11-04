-- Two-step sign-in: the authenticator app's secret per user (sealed with
-- AUTH_ENCRYPTION_KEY), and single-use recovery codes (keyed fingerprints).
-- Owned by src/modules/auth; both cascade with the user row.

-- CreateTable
CREATE TABLE "TwoFactor" (
    "userId" TEXT NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(6),
    "lastUsedStep" INTEGER,

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_userId_fingerprint_key" ON "RecoveryCode"("userId", "fingerprint");

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

