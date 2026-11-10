import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { BanListItem, BanPerson, ModerationRepositoryPort, ModerationState, ModerationWrite } from '../../domain'
import { lockMembership, Tx } from './server-locks'

const PERSON = { id: true, username: true, displayName: true, avatarUrl: true, deletedAt: true } as const

@Injectable()
export class PrismaModerationRepository implements ModerationRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async change(
        serverId: string,
        userId: string,
        targetId: string,
        decide: (state: ModerationState) => ModerationWrite[]
    ): Promise<boolean> {
        return this.prisma.$transaction(async (tx) => {
            // FOR UPDATE: a join through an invite holds this row FOR SHARE, so
            // a ban waits for a join under way and the join for the ban.
            const membership = await lockMembership(tx, serverId, userId)
            if (!membership) return false
            const target = await tx.member.findUnique({
                where: { serverId_userId: { serverId, userId: targetId } },
                select: { userId: true, timeoutUntil: true, roles: { select: { roleId: true } } }
            })
            const ban = await tx.ban.findUnique({
                where: { serverId_userId: { serverId, userId: targetId } },
                select: { userId: true }
            })

            const writes = decide({
                ...membership,
                target: target && {
                    userId: target.userId,
                    roleIds: target.roles.map((role) => role.roleId),
                    timeoutUntil: target.timeoutUntil
                },
                banned: ban !== null
            })
            for (const write of writes) await applyModerationWrite(tx, serverId, write)
            return true
        })
    }

    async bans(serverId: string, page: number, limit: number): Promise<{ items: BanListItem[]; total: number }> {
        const where = { serverId, server: { deletedAt: null } }
        const [rows, total] = await Promise.all([
            this.prisma.ban.findMany({
                where,
                select: { reason: true, createdAt: true, user: { select: PERSON }, bannedBy: { select: PERSON } },
                // Newest first (SRS 5.1); the id keeps two bans of one instant in one order across pages.
                orderBy: [{ createdAt: 'desc' }, { userId: 'asc' }],
                skip: (page - 1) * limit,
                take: limit
            }),
            this.prisma.ban.count({ where })
        ])
        return {
            items: rows.map((row) => ({
                user: person(row.user),
                reason: row.reason,
                createdAt: row.createdAt,
                bannedBy: row.bannedBy && person(row.bannedBy)
            })),
            total
        }
    }
}

function person(user: {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
    deletedAt: Date | null
}): BanPerson {
    if (user.deletedAt) return { userId: user.id, username: null, displayName: null, avatarUrl: null }
    return { userId: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
}

/** One write the domain decided, on someone it checked. */
async function applyModerationWrite(tx: Tx, serverId: string, write: ModerationWrite): Promise<void> {
    const key = { serverId_userId: { serverId, userId: write.userId } }
    switch (write.kind) {
        case 'kick':
            // Their roles go with the membership (cascade); invites they made stay (S-SET-04).
            await tx.member.delete({ where: key })
            return
        case 'ban':
            await tx.member.delete({ where: key })
            await tx.ban.upsert({
                where: key,
                create: { serverId, userId: write.userId, reason: write.reason, bannedById: write.bannedById },
                update: { reason: write.reason, bannedById: write.bannedById, createdAt: new Date() }
            })
            return
        case 'unban':
            await tx.ban.delete({ where: key })
            return
        case 'timeOut':
            await tx.member.update({ where: key, data: { timeoutUntil: write.until, timeoutReason: write.reason } })
            return
        case 'endTimeout':
            await tx.member.update({ where: key, data: { timeoutUntil: null, timeoutReason: null } })
            return
    }
}
