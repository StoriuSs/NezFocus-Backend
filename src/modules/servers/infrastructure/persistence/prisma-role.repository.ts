import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { RoleListItem, RoleRepositoryPort, RoleState, RoleWrite } from '../../domain'
import { lockMembership, Tx } from './server-locks'

const TARGET = { userId: true, timeoutUntil: true, roles: { select: { roleId: true } } } as const

@Injectable()
export class PrismaRoleRepository implements RoleRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async change(
        serverId: string,
        userId: string,
        targetIds: string[],
        decide: (state: RoleState) => RoleWrite[]
    ): Promise<{ createdId: string | null } | null> {
        return this.prisma.$transaction(async (tx) => {
            // The same lock as every change to the channel list (D-149): one
            // change to a server's roles at a time, each deciding on rows no
            // other change can alter before it commits.
            const membership = await lockMembership(tx, serverId, userId)
            if (!membership) return null
            const targets =
                targetIds.length === 0
                    ? []
                    : await tx.member.findMany({ where: { serverId, userId: { in: targetIds } }, select: TARGET })

            const { server, member } = membership
            const writes = decide({
                server,
                member,
                targets: targets.map((target) => ({
                    userId: target.userId,
                    roleIds: target.roles.map((role) => role.roleId),
                    timeoutUntil: target.timeoutUntil
                }))
            })
            let createdId: string | null = null
            for (const write of writes) createdId = (await applyRoleWrite(tx, serverId, write)) ?? createdId
            return { createdId }
        })
    }

    async list(serverId: string): Promise<RoleListItem[]> {
        const server = await this.prisma.server.findFirst({
            where: { id: serverId, deletedAt: null },
            select: {
                _count: { select: { members: true } },
                roles: {
                    select: {
                        id: true,
                        name: true,
                        position: true,
                        permissions: true,
                        mentionable: true,
                        isEveryone: true,
                        _count: { select: { members: true } }
                    }
                }
            }
        })
        if (!server) return []
        return server.roles
            .map(({ _count, ...role }) => ({
                ...role,
                memberCount: role.isEveryone ? server._count.members : _count.members
            }))
            .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
    }
}

/** One write the domain decided; the id of the role it created, if any. Every id was checked to be this server's. */
async function applyRoleWrite(tx: Tx, serverId: string, write: RoleWrite): Promise<string | null> {
    switch (write.kind) {
        case 'createRole': {
            const role = await tx.role.create({
                data: { serverId, name: write.name, nameKey: write.nameKey, position: write.position },
                select: { id: true }
            })
            return role.id
        }
        case 'updateRole':
            await tx.role.update({ where: { id: write.id }, data: write.changes })
            return null
        case 'deleteRole':
            // Who held it, and the private channels it showed, go with it (cascade).
            await tx.role.delete({ where: { id: write.id } })
            return null
        case 'placeRoles': {
            const { places } = write
            await tx.$executeRaw`
                UPDATE "Role" AS r
                SET "position" = p."position", "updatedAt" = now()
                FROM unnest(
                    ${places.map((place) => place.id)}::text[],
                    ${places.map((place) => place.position)}::int[]
                ) AS p("id", "position")
                WHERE r."id" = p."id" AND r."serverId" = ${serverId}
            `
            return null
        }
        case 'grantRole':
            await tx.memberRole.createMany({
                data: write.userIds.map((userId) => ({ serverId, userId, roleId: write.roleId })),
                skipDuplicates: true
            })
            return null
        case 'revokeRole':
            await tx.memberRole.deleteMany({ where: { serverId, userId: write.userId, roleId: write.roleId } })
            return null
    }
}
