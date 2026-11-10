import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { AccessSourcePort } from '../../application/ports'
import { AccessMember, AccessServer } from '../../domain'

/**
 * Reads, never writes, the servers module's tables (ARCHITECTURE 2.1: the one
 * exception, so the two modules do not import each other).
 */
@Injectable()
export class PrismaAccessSource implements AccessSourcePort {
    constructor(private readonly prisma: PrismaService) {}

    async loadServer(serverId: string): Promise<AccessServer | null> {
        // One snapshot: roles and channels read in separate statements must
        // not straddle a change (a role deleted between the two reads).
        return this.prisma.$transaction(
            async (tx) => {
                const server = await tx.server.findFirst({
                    where: { id: serverId, deletedAt: null },
                    select: { ownerId: true }
                })
                if (!server) return null
                // One after the other: a transaction holds one connection.
                const roles = await tx.role.findMany({
                    where: { serverId },
                    select: { id: true, permissions: true, position: true, isEveryone: true }
                })
                const channels = await tx.channel.findMany({
                    where: { serverId },
                    select: {
                        id: true,
                        type: true,
                        isPrivate: true,
                        sendMode: true,
                        viewRoles: { select: { roleId: true } }
                    }
                })
                return {
                    ownerId: server.ownerId,
                    roles,
                    channels: channels.map(({ viewRoles, ...channel }) => ({
                        ...channel,
                        viewRoleIds: viewRoles.map((view) => view.roleId)
                    }))
                }
            },
            { isolationLevel: 'RepeatableRead' }
        )
    }

    async loadMember(serverId: string, userId: string): Promise<AccessMember | null> {
        const member = await this.prisma.member.findUnique({
            where: { serverId_userId: { serverId, userId } },
            select: { timeoutUntil: true, roles: { select: { roleId: true } } }
        })
        if (!member) return null
        return { userId, roleIds: member.roles.map((role) => role.roleId), timeoutUntil: member.timeoutUntil }
    }
}
