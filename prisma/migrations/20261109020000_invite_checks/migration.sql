-- No link was made before M1 L6, when invites arrive: none lacks a lifetime.
DELETE FROM "Invite" WHERE ("maxAgeSeconds" IS NULL) <> ("expiresAt" IS NULL);

-- A link expires exactly when it was given a lifetime (D-151); uses stay
-- within 0 and the limit of 1-100 (REQ-SRV-03). Prisma cannot express these.
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_lifetime_check" CHECK (("maxAgeSeconds" IS NULL) = ("expiresAt" IS NULL));
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_uses_check" CHECK (
    "uses" >= 0 AND ("maxUses" IS NULL OR ("maxUses" BETWEEN 1 AND 100 AND "uses" <= "maxUses"))
);
