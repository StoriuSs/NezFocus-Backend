import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    INVITE_LIST_LIMIT,
    InviteCreator,
    InviteInvalidError,
    InviteListRow,
    InvitePreviewSnapshot,
    InviteRecord,
    InviteRepositoryPort,
    JoinDecision,
    JoinFacts
} from '../../domain'
import { membershipsLock } from './server-locks'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

const INVITE = {
    code: true,
    serverId: true,
    creatorId: true,
    maxAgeSeconds: true,
    maxUses: true,
    uses: true,
    expiresAt: true,
    createdAt: true
} as const

const LIVE_SERVER = { deletedAt: null } as const

@Injectable()
export class PrismaInviteRepository implements InviteRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async insert(invite: Omit<InviteRecord, 'uses' | 'createdAt'>): Promise<boolean> {
        try {
            await this.prisma.invite.create({ data: invite, select: { code: true } })
            return true
        } catch (error) {
            if (prismaCode(error) === 'P2002') return false
            throw error
        }
    }

    async latestOwnUnlimited(
        serverId: string,
        creatorId: string,
        maxAgeSeconds: number | null
    ): Promise<InviteRecord | null> {
        return this.prisma.invite.findFirst({
            where: { serverId, creatorId, maxAgeSeconds, maxUses: null, server: LIVE_SERVER },
            orderBy: { createdAt: 'desc' },
            select: INVITE
        })
    }

    async listLive(serverId: string, now: Date): Promise<InviteListRow[]> {
        const rows = await this.prisma.invite.findMany({
            where: {
                serverId,
                server: LIVE_SERVER,
                AND: [
                    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                    { OR: [{ maxUses: null }, { uses: { lt: this.prisma.invite.fields.maxUses } }] }
                ]
            },
            orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
            take: INVITE_LIST_LIMIT,
            select: {
                ...INVITE,
                creator: {
                    select: {
                        displayName: true,
                        username: true,
                        deletedAt: true,
                        memberships: { where: { serverId }, select: { userId: true } }
                    }
                }
            }
        })
        return rows.map(({ creator: { memberships, ...creator }, ...invite }) => ({
            ...invite,
            creator: creatorOf(creator, memberships.length > 0)
        }))
    }

    async preview(code: string, channelId: string | null): Promise<InvitePreviewSnapshot | null> {
        const row = await this.prisma.invite.findFirst({
            where: { code, server: LIVE_SERVER },
            select: {
                ...INVITE,
                server: {
                    select: {
                        id: true,
                        name: true,
                        iconKey: true,
                        ownerId: true,
                        // Live accounts only, as GET /servers counts (D-161).
                        _count: { select: { members: { where: { user: { deletedAt: null } } } } },
                        roles: {
                            where: { isEveryone: true },
                            select: { id: true, permissions: true, position: true, isEveryone: true }
                        }
                    }
                },
                creator: { select: { displayName: true, username: true, deletedAt: true } }
            }
        })
        if (!row) return null
        const { server, creator, ...invite } = row
        const creatorMembership = await this.prisma.member.findUnique({
            where: { serverId_userId: { serverId: server.id, userId: invite.creatorId } },
            select: { userId: true }
        })

        const channel = channelId
            ? await this.prisma.channel.findFirst({
                  where: { id: channelId, serverId: server.id },
                  select: {
                      id: true,
                      type: true,
                      name: true,
                      isPrivate: true,
                      sendMode: true,
                      isStudyRoom: true,
                      viewRoles: { select: { roleId: true } }
                  }
              })
            : null

        const inviter = creatorOf(creator, creatorMembership !== null)
        return {
            invite,
            server: {
                id: server.id,
                name: server.name,
                iconKey: server.iconKey,
                ownerId: server.ownerId,
                memberCount: server._count.members,
                roles: server.roles
            },
            inviterName: inviter.state === 'member' ? (inviter.displayName ?? inviter.username) : null,
            channel: channel && {
                id: channel.id,
                type: channel.type,
                name: channel.name,
                isPrivate: channel.isPrivate,
                sendMode: channel.sendMode,
                isStudyRoom: channel.isStudyRoom,
                viewRoleIds: channel.viewRoles.map((view) => view.roleId)
            }
        }
    }

    async find(code: string): Promise<InviteRecord | null> {
        return this.prisma.invite.findFirst({ where: { code, server: LIVE_SERVER }, select: INVITE })
    }

    async delete(code: string): Promise<boolean> {
        const { count } = await this.prisma.invite.deleteMany({ where: { code } })
        return count > 0
    }

    async join(
        code: string,
        userId: string,
        decide: (facts: JoinFacts, now: Date) => JoinDecision
    ): Promise<{ serverId: string; decision: JoinDecision }> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${membershipsLock(userId)}, 0))`

            const row = await tx.invite.findUnique({
                where: { code },
                select: { serverId: true, uses: true, maxUses: true, expiresAt: true }
            })
            // Shared: joins do not wait for each other, but a ban or a
            // deletion of the server waits for this join, and this join for them.
            const live = row
                ? await tx.$queryRaw<{ id: string }[]>`
                      SELECT "id" FROM "Server" WHERE "id" = ${row.serverId} AND "deletedAt" IS NULL FOR SHARE
                  `
                : []
            if (!row || live.length === 0) throw new InviteInvalidError()
            // After the waits for the locks: a link that ran out meanwhile is out.
            const now = new Date()

            const { serverId } = row
            const member = await tx.member.findUnique({
                where: { serverId_userId: { serverId, userId } },
                select: { userId: true }
            })
            const ban = await tx.ban.findUnique({
                where: { serverId_userId: { serverId, userId } },
                select: { userId: true }
            })
            const serverCount = await tx.member.count({ where: { userId, server: LIVE_SERVER } })

            const decision = decide(
                { invite: row, isMember: member !== null, isBanned: ban !== null, serverCount },
                now
            )
            if (decision === 'join') {
                const used = await tx.$executeRaw`
                    UPDATE "Invite" SET "uses" = "uses" + 1
                    WHERE "code" = ${code}
                      AND ("maxUses" IS NULL OR "uses" < "maxUses")
                      AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
                `
                // Another join took the last use, or it was revoked, since the read above.
                if (used === 0) throw new InviteInvalidError()
                await tx.member.create({ data: { serverId, userId } })
            }
            return { serverId, decision }
        })
    }
}

function creatorOf(
    creator: { displayName: string | null; username: string | null; deletedAt: Date | null },
    isMember: boolean
): InviteCreator {
    if (creator.deletedAt) return { state: 'deleted' }
    if (!isMember) return { state: 'left' }
    return { state: 'member', displayName: creator.displayName, username: creator.username }
}
