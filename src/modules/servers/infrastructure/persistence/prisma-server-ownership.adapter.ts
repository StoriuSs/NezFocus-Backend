import { Injectable } from '@nestjs/common'
import { BlockingServer, ServerOwnershipPort } from '@/modules/auth'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'

/**
 * The auth module's ServerOwnershipPort, answered from this module's tables
 * (D-160): what deleting an account asks of the servers it owns. "Members"
 * leave out deleted accounts, as `member_count` does (D-161).
 */
@Injectable()
export class PrismaServerOwnership implements ServerOwnershipPort {
    constructor(private readonly prisma: PrismaService) {}

    async serversBlockingDeletion(userId: string): Promise<BlockingServer[]> {
        const rows = await this.prisma.$queryRaw<{ id: string; name: string; memberCount: bigint }[]>`
            SELECT s."id", s."name", count(*) AS "memberCount"
            FROM "Server" s
            JOIN "Member" m ON m."serverId" = s."id"
            JOIN "User" u ON u."id" = m."userId" AND u."deletedAt" IS NULL
            WHERE s."ownerId" = ${userId} AND s."deletedAt" IS NULL
            GROUP BY s."id", s."name"
            HAVING count(*) FILTER (WHERE m."userId" <> ${userId}) > 0
            ORDER BY s."name" ASC, s."id" ASC
        `
        return rows.map((row) => ({ id: row.id, name: row.name, memberCount: Number(row.memberCount) }))
    }

    /**
     * Every live server they own: asked once the request passed
     * serversBlockingDeletion, so each is one they own alone. One somebody
     * joined in between loses its invites too, which is what D-121 wants.
     */
    async revokeSoloServerInvites(userId: string): Promise<void> {
        await this.prisma.invite.deleteMany({ where: { server: { ownerId: userId, deletedAt: null } } })
    }
}
