import { Prisma } from '@/generated/prisma/client'

/**
 * Reading people to show them to someone else (D-182): the columns the rule
 * in shared/domain/shown-person.ts needs, and the same rule in raw SQL.
 * `module-structure.spec.ts` refuses a module outside `users` and `auth`
 * (which read one's own account) that selects a name or picture column itself.
 */

/** The columns of a `User` to read for showing them: their names and picture, and whether they may be shown. */
export const SHOWN_PERSON = {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    deletedAt: true,
    deletionRequestedAt: true
} as const

/** A table alias of `User` in a raw query: letters only, as it goes into the SQL as written. */
const aliasOf = (alias: string): Prisma.Sql => {
    if (!/^[a-z]+$/.test(alias)) throw new Error(`Not a table alias: ${alias}`)
    return Prisma.raw(alias)
}

/** For a raw query: true when the `User` aliased `alias` is shown as a deleted account (`isHidden`). */
export const hiddenSql = (alias: string): Prisma.Sql => {
    const u = aliasOf(alias)
    return Prisma.sql`(${u}."deletedAt" IS NOT NULL OR ${u}."deletionRequestedAt" IS NOT NULL)`
}

/** For a raw query: one of the `User`'s shown columns as others see it, null when hidden. */
export const shownSql = (alias: string, column: 'username' | 'displayName' | 'avatarUrl'): Prisma.Sql =>
    Prisma.sql`(CASE WHEN ${hiddenSql(alias)} THEN NULL ELSE ${aliasOf(alias)}.${Prisma.raw(`"${column}"`)} END)`
