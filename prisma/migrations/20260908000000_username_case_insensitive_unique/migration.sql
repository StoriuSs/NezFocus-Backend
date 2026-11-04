-- Case-insensitive uniqueness for usernames.
--
-- The generated index was byte-exact, so 'Alice', 'alice' and 'ALICE' were
-- three distinct accounts and the availability check reported every one of
-- them as free. For a permanent, publicly displayed handle that is a
-- straightforward impersonation vector.
--
-- Prisma cannot express a functional index, so this is written by hand. The
-- application also normalises to lower case before writing; this index is the
-- guarantee that holds even if a future call site forgets to.
--
-- Only live rows participate: a soft-deleted account must not hold its handle
-- hostage forever.

-- Drop the byte-exact index BEFORE folding case. It covers every row,
-- soft-deleted ones included, so with 'Alice' and 'alice' both present the
-- UPDATE below violated it and the migration failed.
DROP INDEX IF EXISTS "User_username_key";

-- Live accounts whose names differ only in case can't all keep them under a
-- case-insensitive index. The oldest keeps its name; the others become
-- '<name>_<first 6 chars of id>' and must choose again (hasSetUsername false).
WITH ranked AS (
    SELECT "id", row_number() OVER (PARTITION BY lower("username") ORDER BY "createdAt", "id") AS rank
    FROM "User"
    WHERE "username" IS NOT NULL AND "deletedAt" IS NULL
)
UPDATE "User" AS u
SET "username" = lower(u."username") || '_' || substr(u."id", 1, 6), "hasSetUsername" = false
FROM ranked
WHERE u."id" = ranked."id" AND ranked.rank > 1;

-- Fold the remaining usernames to their canonical form.
UPDATE "User" SET "username" = lower("username") WHERE "username" IS NOT NULL;

CREATE UNIQUE INDEX "User_username_active_key"
    ON "User" (lower("username"))
    WHERE "deletedAt" IS NULL AND "username" IS NOT NULL;
