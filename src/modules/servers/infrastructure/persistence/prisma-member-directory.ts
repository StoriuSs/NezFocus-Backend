import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MemberDirectoryPort, MemberListItem, MemberSearch } from '../../application/ports'

interface MemberRow {
    userId: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
    isOwner: boolean
    roleIds: string[]
    joinedAt: Date
}

/** `%`, `_` and `\` typed in the box are looked for as themselves, not as patterns. */
const literal = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

@Injectable()
export class PrismaMemberDirectory implements MemberDirectoryPort {
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
        { q, roleId, page, limit }: MemberSearch
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
                q
                    ? Prisma.sql`AND (lower(unaccent(coalesce(u."displayName", ''))) LIKE lower(unaccent(${`%${literal(q)}%`}))
                        OR lower(unaccent(coalesce(u."username", ''))) LIKE lower(unaccent(${`%${literal(q)}%`})))`
                    : Prisma.empty
            }
        `
        const [rows, counted] = await Promise.all([
            this.prisma.$queryRaw<MemberRow[]>`
                SELECT m."userId", u."username", u."displayName", u."avatarUrl", m."joinedAt",
                    (s."ownerId" = m."userId") AS "isOwner",
                    coalesce((SELECT array_agg(mr."roleId" ORDER BY mr."roleId") FROM "MemberRole" mr
                        WHERE mr."serverId" = m."serverId" AND mr."userId" = m."userId"), '{}') AS "roleIds"
                FROM "Member" m
                JOIN "User" u ON u."id" = m."userId"
                JOIN "Server" s ON s."id" = m."serverId"
                WHERE ${where}
                -- By name without accents or case (D-89, as C-13), then username; the id keeps two
                -- equal names in one order across pages.
                ORDER BY lower(unaccent(coalesce(u."displayName", u."username", ''))),
                    lower(coalesce(u."username", '')), m."userId"
                LIMIT ${limit} OFFSET ${(page - 1) * limit}
            `,
            this.prisma.$queryRaw<{ total: bigint }[]>`
                SELECT count(*) AS total FROM "Member" m JOIN "User" u ON u."id" = m."userId" WHERE ${where}
            `
        ])
        return { items: rows, total: Number(counted[0]?.total ?? 0n) }
    }
}
