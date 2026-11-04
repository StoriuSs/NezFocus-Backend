-- When the identity provider confirmed a soft-deleted user's identity is gone.
-- NULL on a deleted row means the hard delete is still pending, or was lost;
-- the maintenance sweep finds and re-schedules those.
ALTER TABLE "User" ADD COLUMN "identityDeletedAt" TIMESTAMPTZ(6);
