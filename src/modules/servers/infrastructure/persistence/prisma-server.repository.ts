import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MembershipSnapshot, NewServer, ServerRepositoryPort } from '../../application/ports'
import { LayoutState, LayoutWrite, nameKey } from '../../domain'

/**
 * The advisory lock that serialises everything adding a server to one
 * person's list — creating one now, joining one in L6 — so the count of their
 * servers cannot change between reading it and acting on it. Scoped to the
 * transaction (released at commit or rollback), and this module's own concern
 * rather than a lock on the users module's row.
 */
const membershipsLock = (userId: string) => `server-memberships:${userId}`

const EVERYONE = '@everyone'

/** Everything one member's view of a server, or a change to its channel list, is decided from. */
const MEMBERSHIP = {
    userId: true,
    timeoutUntil: true,
    roles: { select: { roleId: true } },
    server: {
        select: {
            id: true,
            name: true,
            iconKey: true,
            ownerId: true,
            welcomeChannelId: true,
            categories: { select: { id: true, name: true, position: true } },
            roles: { select: { id: true, name: true, permissions: true, position: true, isEveryone: true } },
            channels: {
                select: {
                    id: true,
                    categoryId: true,
                    type: true,
                    name: true,
                    position: true,
                    isPrivate: true,
                    sendMode: true,
                    isStudyRoom: true,
                    taskBoardEnabled: true,
                    viewRoles: { select: { roleId: true } }
                }
            }
        }
    }
} as const

type ChannelRow = Omit<MembershipSnapshot['server']['channels'][number], 'viewRoleIds'> & {
    viewRoles: { roleId: string }[]
}

interface MembershipRow {
    userId: string
    timeoutUntil: Date | null
    roles: { roleId: string }[]
    server: Omit<MembershipSnapshot['server'], 'channels'> & { channels: ChannelRow[] }
}

function toMembership({ server, ...member }: MembershipRow): MembershipSnapshot {
    return {
        server: {
            ...server,
            channels: server.channels.map(({ viewRoles, ...channel }) => ({
                ...channel,
                viewRoleIds: viewRoles.map((view) => view.roleId)
            }))
        },
        member: {
            userId: member.userId,
            roleIds: member.roles.map((role) => role.roleId),
            timeoutUntil: member.timeoutUntil
        }
    }
}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

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

    async listForMember(userId: string, serverId?: string): Promise<MembershipSnapshot[]> {
        const rows = await this.prisma.member.findMany({
            where: { userId, ...(serverId ? { serverId } : {}), server: { deletedAt: null } },
            // Join order (C-05); a second ordering so the same instant never shuffles.
            orderBy: [{ joinedAt: 'asc' }, { serverId: 'asc' }],
            select: MEMBERSHIP
        })
        return rows.map(toMembership)
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
                select: MEMBERSHIP
            })
            if (!row) return null

            let createdId: string | null = null
            for (const write of decide(toMembership(row))) {
                createdId = (await applyWrite(tx, serverId, write)) ?? createdId
            }
            return { createdId }
        })
    }
}

/** One write the domain decided; the id of the row it created, if any. Every id was checked to be this server's. */
async function applyWrite(tx: Tx, serverId: string, write: LayoutWrite): Promise<string | null> {
    switch (write.kind) {
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
            // Its view roles go with it; invites to it lose their channel, and
            // a server welcoming there sends none (D-83).
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
