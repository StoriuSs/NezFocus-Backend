import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { hiddenSql, shownSql } from '@/shared/infrastructure/persistence/shown-person'
import { MemberListItem, MemberRepositoryPort, MemberSearch, MemberSort, SortOrder } from '../../domain'

interface MemberRow {
    userId: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
    isOwner: boolean
    roleIds: string[]
    joinedAt: Date
    timeoutUntil: Date | null
    timeoutReason: string | null
}

/** `%`, `_` and `\` typed in the box are looked for as themselves, not as patterns. */
const literal = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

/**
 * Names as others see them: an account waiting to be deleted has none (D-182),
 * so no search finds it, and it sorts after everyone by name (HIDDEN first in
 * every ORDER BY that goes by name).
 */
const SHOWN_NAME = shownSql('u', 'displayName')
const SHOWN_USERNAME = shownSql('u', 'username')
const HIDDEN = hiddenSql('u')
const NAME = Prisma.sql`lower(unaccent(coalesce(${SHOWN_NAME}, ${SHOWN_USERNAME}, '')))`
const USERNAME = Prisma.sql`lower(coalesce(${SHOWN_USERNAME}, ''))`

/**
 * The ORDER BY of one sort (D-89). Ties go by name, then username, A → Z,
 * whichever way the column runs; the id keeps two equal rows in one order
 * across pages. Role rank: the owner above every role, then the highest
 * position held, 0 for none.
 */
function orderBy(sort: MemberSort, order: SortOrder, presentIds: string[]): Prisma.Sql {
    const way = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
    const ties = Prisma.sql`${HIDDEN} ASC, ${NAME} ASC, ${USERNAME} ASC, m."userId" ASC`
    switch (sort) {
        case 'presence':
            // Those shown first: false sorts before true, so ASC puts the absent ones first.
            return Prisma.sql`(m."userId" = ANY(${presentIds}::text[])) ${order === 'asc' ? Prisma.sql`DESC` : Prisma.sql`ASC`}, ${ties}`
        case 'name':
            return Prisma.sql`${HIDDEN} ASC, ${NAME} ${way}, ${USERNAME} ASC, m."userId" ASC`
        case 'joined_at':
            return Prisma.sql`m."joinedAt" ${way}, ${ties}`
        case 'role':
            return Prisma.sql`(CASE WHEN s."ownerId" = m."userId" THEN 2147483647 ELSE coalesce((
                    SELECT max(r."position") FROM "MemberRole" mr JOIN "Role" r ON r."id" = mr."roleId"
                    WHERE mr."serverId" = m."serverId" AND mr."userId" = m."userId"), 0) END) ${way}, ${ties}`
    }
}

@Injectable()
export class PrismaMemberRepository implements MemberRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Folded with `unaccent` (migration 20261110000000_unaccent) and lower
     * case on both sides, so "binh" finds "Bình" and "đ" finds "d" (D-152).
     * Scanned within the one server, through the Member primary key; no
     * index helps a match in the middle of a name, and none is needed at the
     * size of a study group.
     */
    async search(
        serverId: string,
        { q, roleId, transferableFrom, sort, order, page, limit, presence }: MemberSearch,
        presentIds: string[]
    ): Promise<{ items: MemberListItem[]; total: number }> {
        const where = Prisma.sql`
            m."serverId" = ${serverId}
            AND u."deletedAt" IS NULL
            ${
                roleId
                    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "MemberRole" r
                        WHERE r."serverId" = m."serverId" AND r."userId" = m."userId" AND r."roleId" = ${roleId})`
                    : Prisma.empty
            }
            ${
                transferableFrom
                    ? Prisma.sql`AND m."userId" <> ${transferableFrom} AND u."deletionRequestedAt" IS NULL`
                    : Prisma.empty
            }
            ${
                presence === 'online'
                    ? Prisma.sql`AND m."userId" = ANY(${presentIds}::text[])`
                    : presence === 'offline'
                      ? Prisma.sql`AND NOT (m."userId" = ANY(${presentIds}::text[]))`
                      : Prisma.empty
            }
            ${
                q
                    ? Prisma.sql`AND (lower(unaccent(coalesce(${SHOWN_NAME}, ''))) LIKE lower(unaccent(${`%${literal(q)}%`}))
                        OR lower(unaccent(coalesce(${SHOWN_USERNAME}, ''))) LIKE lower(unaccent(${`%${literal(q)}%`})))`
                    : Prisma.empty
            }
        `
        const [rows, counted] = await Promise.all([
            this.prisma.$queryRaw<MemberRow[]>`
                SELECT m."userId", ${SHOWN_USERNAME} AS "username", ${SHOWN_NAME} AS "displayName",
                    ${shownSql('u', 'avatarUrl')} AS "avatarUrl", m."joinedAt",
                    m."timeoutUntil", m."timeoutReason",
                    (s."ownerId" = m."userId") AS "isOwner",
                    coalesce((SELECT array_agg(mr."roleId" ORDER BY mr."roleId") FROM "MemberRole" mr
                        WHERE mr."serverId" = m."serverId" AND mr."userId" = m."userId"), '{}') AS "roleIds"
                FROM "Member" m
                JOIN "User" u ON u."id" = m."userId"
                JOIN "Server" s ON s."id" = m."serverId"
                WHERE ${where}
                ORDER BY ${orderBy(sort, order, presentIds)}
                LIMIT ${limit} OFFSET ${(page - 1) * limit}
            `,
            this.prisma.$queryRaw<{ total: bigint }[]>`
                SELECT count(*) AS total FROM "Member" m JOIN "User" u ON u."id" = m."userId" WHERE ${where}
            `
        ])
        return { items: rows, total: Number(counted[0]?.total ?? 0n) }
    }

    async countAmong(serverId: string, userIds: string[]): Promise<number> {
        if (userIds.length === 0) return 0
        return this.prisma.member.count({ where: { serverId, userId: { in: userIds }, user: { deletedAt: null } } })
    }
}
