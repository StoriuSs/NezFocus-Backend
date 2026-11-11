import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    LayoutState,
    LayoutWrite,
    LeftoverMembership,
    ListedMembership,
    MembershipState,
    MembershipWrite,
    nameKey,
    NewServer,
    ServerRepositoryPort
} from '../../domain'
import { membershipSelect, toMembership } from './membership.selections'
import { lockMembership, membershipsLock, Tx } from './server-locks'

const EVERYONE = '@everyone'

@Injectable()
export class PrismaServerRepository implements ServerRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async create({ ownerId, name, plan, maxServers }: NewServer): Promise<{ serverId: string } | null> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${membershipsLock(ownerId)}, 0))`
            const inServers = await tx.member.count({ where: { userId: ownerId, server: { deletedAt: null } } })
            if (inServers >= maxServers) return null

            const server = await tx.server.create({ data: { name, ownerId }, select: { id: true } })
            const serverId = server.id

            await tx.role.create({
                data: {
                    serverId,
                    name: EVERYONE,
                    nameKey: nameKey(EVERYONE),
                    permissions: plan.everyonePermissions,
                    position: 0,
                    isEveryone: true
                }
            })
            const roles = await tx.role.createManyAndReturn({
                data: plan.roles.map((role, index) => ({
                    serverId,
                    name: role.name,
                    nameKey: nameKey(role.name),
                    permissions: role.permissions,
                    position: index + 1
                })),
                select: { id: true, name: true }
            })

            await tx.member.create({ data: { serverId, userId: ownerId } })
            const ownerRoles = plan.roles.filter((role) => role.givenToOwner).map((role) => role.name)
            await tx.memberRole.createMany({
                data: roles
                    .filter((role) => ownerRoles.includes(role.name))
                    .map((role) => ({ serverId, userId: ownerId, roleId: role.id }))
            })

            let categoryPosition = 0
            let welcomeChannelId: string | null = null
            for (const group of plan.groups) {
                const category = group.name
                    ? await tx.category.create({
                          data: {
                              serverId,
                              name: group.name,
                              nameKey: nameKey(group.name),
                              position: categoryPosition++
                          },
                          select: { id: true }
                      })
                    : null
                const channels = await tx.channel.createManyAndReturn({
                    data: group.channels.map((channel, position) => ({
                        serverId,
                        categoryId: category?.id ?? null,
                        type: channel.type,
                        name: channel.name,
                        nameKey: nameKey(channel.name),
                        position,
                        sendMode: channel.sendMode,
                        isStudyRoom: channel.isStudyRoom,
                        taskBoardEnabled: channel.taskBoardEnabled
                    })),
                    select: { id: true, type: true, name: true }
                })
                const welcome = channels.find((c) => c.type === 'text' && c.name === plan.welcomeChannel)
                welcomeChannelId ??= welcome?.id ?? null
            }
            await tx.server.update({ where: { id: serverId }, data: { welcomeChannelId } })

            return { serverId }
        })
    }

    async listForMember(userId: string, serverId?: string): Promise<ListedMembership[]> {
        const rows = await this.prisma.member.findMany({
            where: { userId, ...(serverId ? { serverId } : {}), server: { deletedAt: null } },
            // Join order (C-05); a second ordering so the same instant never shuffles.
            orderBy: [{ joinedAt: 'asc' }, { serverId: 'asc' }],
            select: membershipSelect
        })
        if (rows.length === 0) return []
        // One grouped count for the whole list (D-161), through the Member primary key.
        const counts = await this.prisma.member.groupBy({
            by: ['serverId'],
            where: { serverId: { in: rows.map((row) => row.server.id) }, user: { deletedAt: null } },
            _count: { _all: true }
        })
        const countOf = new Map(counts.map((count) => [count.serverId, count._count._all]))
        return rows.map((row) => ({ ...toMembership(row), memberCount: countOf.get(row.server.id) ?? 0 }))
    }

    async replaceIcon(serverId: string, iconKey: string | null): Promise<{ previousIconKey: string | null } | null> {
        // The subquery's FOR UPDATE makes a concurrent upload wait and then
        // read the key this one wrote: each statement returns the key it
        // actually replaced (as replaceAvatar in the users module).
        const rows = await this.prisma.$queryRaw<{ previous: string | null }[]>`
            UPDATE "Server" AS s
            SET "iconKey" = ${iconKey}, "updatedAt" = now()
            FROM (SELECT "id", "iconKey" FROM "Server" WHERE "id" = ${serverId} AND "deletedAt" IS NULL FOR UPDATE) AS old
            WHERE s."id" = old."id"
            RETURNING old."iconKey" AS previous
        `
        return rows.length === 0 ? null : { previousIconKey: rows[0].previous }
    }

    async changeLayout(
        serverId: string,
        userId: string,
        decide: (state: LayoutState) => LayoutWrite[]
    ): Promise<{ createdId: string | null } | null> {
        return this.prisma.$transaction(async (tx) => {
            // The lock every change to this server's lists takes first (D-149).
            const locked = await tx.$queryRaw<{ id: string }[]>`
                SELECT "id" FROM "Server" WHERE "id" = ${serverId} AND "deletedAt" IS NULL FOR UPDATE
            `
            if (locked.length === 0) return null
            const row = await tx.member.findUnique({
                where: { serverId_userId: { serverId, userId } },
                select: membershipSelect
            })
            if (!row) return null

            let createdId: string | null = null
            for (const write of decide(toMembership(row))) {
                createdId = (await applyWrite(tx, serverId, write)) ?? createdId
            }
            return { createdId }
        })
    }

    async changeMembership(
        serverId: string,
        userId: string,
        targetId: string | null,
        decide: (state: MembershipState) => MembershipWrite[]
    ): Promise<boolean> {
        return this.prisma.$transaction(async (tx) => {
            // The same lock as every change to the server's members and roles,
            // so a handover never races a kick or a role given to the recipient.
            const membership = await lockMembership(tx, serverId, userId)
            if (!membership) return false
            const otherMembers = await tx.member.count({
                where: { serverId, userId: { not: userId }, user: { deletedAt: null } }
            })
            // FOR SHARE on their account: asking to delete it (an UPDATE) waits
            // for this handover, then sees them as owner and is taken back; a
            // request saved first is seen here (L9 review).
            if (targetId) await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${targetId} FOR SHARE`
            const target = targetId
                ? await tx.member.findUnique({
                      where: { serverId_userId: { serverId, userId: targetId } },
                      select: {
                          userId: true,
                          timeoutUntil: true,
                          roles: { select: { roleId: true } },
                          user: { select: { deletedAt: true, deletionRequestedAt: true } }
                      }
                  })
                : null

            const writes = decide({
                ...membership,
                otherMembers,
                // A deleted account is in no server any more, whatever rows remain.
                target:
                    target && !target.user.deletedAt
                        ? {
                              userId: target.userId,
                              roleIds: target.roles.map((role) => role.roleId),
                              timeoutUntil: target.timeoutUntil,
                              pendingDeletion: target.user.deletionRequestedAt !== null
                          }
                        : null
            })
            for (const write of writes) await applyMembershipWrite(tx, serverId, write)
            return true
        })
    }

    async serverIdsOf(userId: string): Promise<string[]> {
        const rows = await this.prisma.member.findMany({
            where: { userId, server: { deletedAt: null } },
            select: { serverId: true }
        })
        return rows.map((row) => row.serverId)
    }

    async forgetBansOf(userId: string): Promise<void> {
        await this.prisma.ban.deleteMany({ where: { userId, user: { deletedAt: { not: null } } } })
    }

    async forgetBansOfDeleted(): Promise<void> {
        // Every deleted account (User_deletedAt_idx), then Ban_userId_idx for each.
        await this.prisma.ban.deleteMany({ where: { user: { deletedAt: { not: null } } } })
    }

    async leftoverMemberships(limit: number): Promise<LeftoverMembership[]> {
        return this.prisma.$queryRaw<LeftoverMembership[]>`
            SELECT m."serverId", m."userId"
            FROM "Member" m
            JOIN "User" u ON u."id" = m."userId"
            JOIN "Server" s ON s."id" = m."serverId"
            WHERE u."deletedAt" IS NOT NULL
                AND s."deletedAt" IS NULL
                AND NOT (
                    s."ownerId" = m."userId"
                    AND EXISTS (
                        SELECT 1 FROM "Member" o JOIN "User" ou ON ou."id" = o."userId"
                        WHERE o."serverId" = s."id" AND o."userId" <> m."userId" AND ou."deletedAt" IS NULL
                    )
                )
            ORDER BY m."serverId" ASC, m."userId" ASC
            LIMIT ${limit}
        `
    }

    async deletedBefore(before: Date, limit: number): Promise<{ serverId: string; iconKey: string | null }[]> {
        const rows = await this.prisma.server.findMany({
            where: { deletedAt: { not: null, lte: before } },
            select: { id: true, iconKey: true },
            orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
            take: limit
        })
        return rows.map((row) => ({ serverId: row.id, iconKey: row.iconKey }))
    }

    async purge(serverIds: string[]): Promise<void> {
        if (serverIds.length === 0) return
        // Categories, channels, roles, members, invites and bans go with it (ON DELETE CASCADE).
        await this.prisma.server.deleteMany({ where: { id: { in: serverIds }, deletedAt: { not: null } } })
    }
}

/** One leave, deletion or handover the domain decided. */
async function applyMembershipWrite(tx: Tx, serverId: string, write: MembershipWrite): Promise<void> {
    switch (write.kind) {
        case 'leave':
            // Their roles go with the row (MemberRole, ON DELETE CASCADE).
            await tx.member.delete({ where: { serverId_userId: { serverId, userId: write.userId } } })
            return
        case 'transferOwnership':
            await tx.server.update({ where: { id: serverId }, data: { ownerId: write.toUserId } })
            return
        case 'deleteServer':
            await tx.server.update({ where: { id: serverId }, data: { deletedAt: new Date() } })
            return
    }
}

/** One write the domain decided; the id of the row it created, if any. Every id was checked to be this server's. */
async function applyWrite(tx: Tx, serverId: string, write: LayoutWrite): Promise<string | null> {
    switch (write.kind) {
        case 'updateServer':
            await tx.server.update({ where: { id: serverId }, data: write.changes })
            return null
        case 'createCategory': {
            const category = await tx.category.create({
                data: { serverId, name: write.name, nameKey: write.nameKey, position: write.position },
                select: { id: true }
            })
            return category.id
        }
        case 'renameCategory':
            await tx.category.update({ where: { id: write.id }, data: { name: write.name, nameKey: write.nameKey } })
            return null
        case 'deleteCategory':
            await tx.category.delete({ where: { id: write.id } })
            return null
        case 'createChannel': {
            const { viewRoleIds, ...channel } = write.channel
            const created = await tx.channel.create({ data: { serverId, ...channel }, select: { id: true } })
            await tx.channelViewRole.createMany({
                data: viewRoleIds.map((roleId) => ({ channelId: created.id, roleId, serverId }))
            })
            return created.id
        }
        case 'updateChannel': {
            const { viewRoleIds, ...columns } = write.changes
            if (Object.keys(columns).length > 0) await tx.channel.update({ where: { id: write.id }, data: columns })
            if (viewRoleIds) {
                await tx.channelViewRole.deleteMany({ where: { channelId: write.id } })
                await tx.channelViewRole.createMany({
                    data: viewRoleIds.map((roleId) => ({ channelId: write.id, roleId, serverId }))
                })
            }
            return null
        }
        case 'deleteChannel':
            // Its view roles go with it, and a server welcoming there sends
            // none (D-83). A link naming it opens the first text channel (D-150).
            await tx.channel.delete({ where: { id: write.id } })
            return null
        case 'placeChannels': {
            const { places } = write
            // One statement for a whole group, however long it is.
            await tx.$executeRaw`
                UPDATE "Channel" AS c
                SET "categoryId" = p."categoryId", "position" = p."position", "updatedAt" = now()
                FROM unnest(
                    ${places.map((place) => place.id)}::text[],
                    ${places.map((place) => place.categoryId)}::text[],
                    ${places.map((place) => place.position)}::int[]
                ) AS p("id", "categoryId", "position")
                WHERE c."id" = p."id" AND c."serverId" = ${serverId}
            `
            return null
        }
        case 'placeCategories': {
            const { places } = write
            await tx.$executeRaw`
                UPDATE "Category" AS c
                SET "position" = p."position", "updatedAt" = now()
                FROM unnest(
                    ${places.map((place) => place.id)}::text[],
                    ${places.map((place) => place.position)}::int[]
                ) AS p("id", "position")
                WHERE c."id" = p."id" AND c."serverId" = ${serverId}
            `
            return null
        }
    }
}
