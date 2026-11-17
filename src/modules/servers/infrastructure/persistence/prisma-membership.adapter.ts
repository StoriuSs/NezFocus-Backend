import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ChannelMemberFilter, MemberSince, Membership, MembershipPort } from '../../application/ports'
import { holdsOneOf, viewing } from './channel-viewers'

/** MembershipPort, answered from the Member table (its index on userId). */
@Injectable()
export class PrismaMembership implements MembershipPort {
    constructor(private readonly prisma: PrismaService) {}

    async serverIdsOf(userId: string): Promise<string[]> {
        return (await this.membershipsOf(userId)).map((membership) => membership.serverId)
    }

    async membersAmong(serverId: string, userIds: string[]): Promise<string[]> {
        if (userIds.length === 0) return []
        const rows = await this.prisma.member.findMany({
            where: { serverId, userId: { in: userIds }, user: { deletedAt: null } },
            select: { userId: true }
        })
        return rows.map((row) => row.userId)
    }

    async channelMembers(serverId: string, { viewers, roleIds, userIds }: ChannelMemberFilter): Promise<MemberSince[]> {
        // Within the one server, through the Member primary key; the role checks are its MemberRole rows.
        return this.prisma.$queryRaw<MemberSince[]>`
            SELECT m."userId", m."joinedAt"
            FROM "Member" m
            JOIN "Server" s ON s."id" = m."serverId"
            JOIN "User" u ON u."id" = m."userId"
            WHERE m."serverId" = ${serverId} AND s."deletedAt" IS NULL AND u."deletedAt" IS NULL
                ${viewers ? viewing(viewers) : Prisma.empty}
                ${roleIds ? Prisma.sql`AND ${holdsOneOf(roleIds)}` : Prisma.empty}
                ${userIds ? Prisma.sql`AND m."userId" = ANY(${userIds}::text[])` : Prisma.empty}
        `
    }

    async membershipsOf(userId: string): Promise<Membership[]> {
        return this.prisma.member.findMany({
            where: { userId, server: { deletedAt: null } },
            select: { serverId: true, joinedAt: true }
        })
    }
}
