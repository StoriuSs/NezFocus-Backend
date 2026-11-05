-- NezFocus has no two-step sign-in (D-126): the authenticator secrets and the
-- recovery codes go with their tables.

-- DropForeignKey
ALTER TABLE "RecoveryCode" DROP CONSTRAINT "RecoveryCode_userId_fkey";

-- DropForeignKey
ALTER TABLE "TwoFactor" DROP CONSTRAINT "TwoFactor_userId_fkey";

-- DropTable
DROP TABLE "RecoveryCode";

-- DropTable
DROP TABLE "TwoFactor";
