import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    ActiveSession,
    RevokeReason,
    RotateInput,
    RotationOutcome,
    SessionEnd,
    SessionRecord,
    SessionRepositoryPort
} from '@/modules/auth/domain'

/** How a session ended, or null while it is active. */
function endOf(
    session: {
        revokedAt: Date | null
        revokedReason: string | null
        expiresAt: Date
        user: { deletedAt: Date | null }
    },
    now: Date
): SessionEnd | null {
    if (session.user.deletedAt) return 'account-deleted'
    if (session.revokedAt) return (session.revokedReason as RevokeReason | null) ?? 'logout'
    if (session.expiresAt <= now) return 'expired'
    return null
}

const toRecord = (session: { id: string; userId: string; expiresAt: Date }): SessionRecord => ({
    id: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt
})

interface LockedToken {
    id: string
    sessionId: string
    expiresAt: Date
    usedAt: Date | null
    replacedById: string | null
}

@Injectable()
export class PrismaSessionRepository implements SessionRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async create(input: {
        userId: string
        expiresAt: Date
        refreshTokenHash: string
        userAgent?: string
        ip?: string
    }): Promise<SessionRecord> {
        const session = await this.prisma.session.create({
            data: {
                userId: input.userId,
                expiresAt: input.expiresAt,
                userAgent: input.userAgent,
                ip: input.ip,
                refreshTokens: { create: { tokenHash: input.refreshTokenHash, expiresAt: input.expiresAt } }
            }
        })
        return toRecord(session)
    }

    async findActive(id: string, now: Date): Promise<SessionRecord | null> {
        const session = await this.prisma.session.findFirst({
            where: { id, revokedAt: null, expiresAt: { gt: now } }
        })
        return session ? toRecord(session) : null
    }

    listActive(userId: string, now: Date): Promise<ActiveSession[]> {
        return this.prisma.session.findMany({
            where: { userId, revokedAt: null, expiresAt: { gt: now } },
            select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true, ip: true }
        })
    }

    async findEnded(id: string, now: Date): Promise<SessionEnd | null> {
        const session = await this.prisma.session.findUnique({
            where: { id },
            select: { revokedAt: true, revokedReason: true, expiresAt: true, user: { select: { deletedAt: true } } }
        })
        return session ? endOf(session, now) : null
    }

    /**
     * Everything about one presented refresh token, decided with its row
     * locked. A second refresh with the same token (another tab, or a thief)
     * waits for this one to commit, then sees the token as used — and whatever
     * `beforeCommit` stored for it.
     */
    rotate({ tokenHash, newTokenHash, now, graceMs, client, beforeCommit }: RotateInput): Promise<RotationOutcome> {
        return this.prisma.$transaction(async (tx) => {
            const [token] = await tx.$queryRaw<LockedToken[]>`
                SELECT "id", "sessionId", "expiresAt", "usedAt", "replacedById"
                FROM "RefreshToken" WHERE "tokenHash" = ${tokenHash}
                FOR UPDATE`
            if (!token) return { kind: 'invalid' }
            if (token.expiresAt <= now) return { kind: 'invalid', ended: 'expired' }

            // The account too: its sessions end in an event handler that runs
            // just after a deletion, and a refresh in between must not succeed.
            const session = await tx.session.findUnique({
                where: { id: token.sessionId },
                include: { user: { select: { deletedAt: true } } }
            })
            if (!session) return { kind: 'invalid' }
            const ended = endOf(session, now)
            if (ended) return { kind: 'invalid', ended }

            if (!token.usedAt) {
                const replacement = await tx.refreshToken.create({
                    data: { sessionId: session.id, tokenHash: newTokenHash, expiresAt: session.expiresAt }
                })
                await tx.refreshToken.update({
                    where: { id: token.id },
                    data: { usedAt: now, replacedById: replacement.id }
                })
                // Where and in what it was last used, with when (D-138); undefined leaves a column as it was.
                await tx.session.update({
                    where: { id: session.id },
                    data: { lastUsedAt: now, ip: client?.ip, userAgent: client?.userAgent }
                })
                await beforeCommit()
                return { kind: 'rotated', session: toRecord(session) }
            }

            // Used before. Moments ago, with its replacement still unused, it
            // is the same client twice; anything else is a copy being replayed.
            if (now.getTime() - token.usedAt.getTime() <= graceMs && token.replacedById) {
                const replacement = await tx.refreshToken.findUnique({ where: { id: token.replacedById } })
                if (replacement && !replacement.usedAt) return { kind: 'grace', session: toRecord(session) }
            }

            await tx.session.update({
                where: { id: session.id },
                data: { revokedAt: now, revokedReason: 'reuse-detected' satisfies RevokeReason }
            })
            return { kind: 'reused', session: toRecord(session) }
        })
    }

    async revokeByTokenHash(tokenHash: string, reason: RevokeReason, now: Date): Promise<string | null> {
        const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, select: { sessionId: true } })
        if (!token) return null
        const result = await this.prisma.session.updateMany({
            where: { id: token.sessionId, revokedAt: null },
            data: { revokedAt: now, revokedReason: reason }
        })
        return result.count > 0 ? token.sessionId : null
    }

    async revokeOne(userId: string, sessionId: string, reason: RevokeReason, now: Date): Promise<boolean> {
        const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId }, select: { id: true } })
        if (!session) return false
        await this.prisma.session.updateMany({
            where: { id: sessionId, revokedAt: null },
            data: { revokedAt: now, revokedReason: reason }
        })
        return true
    }

    async revokeAllForUser(
        userId: string,
        reason: RevokeReason,
        now: Date,
        exceptSessionId?: string
    ): Promise<string[]> {
        const revoked = await this.prisma.session.updateManyAndReturn({
            // Live ones only: a lapsed session has nothing to end, and counting it
            // would sign out more devices than the list showed.
            where: {
                userId,
                revokedAt: null,
                expiresAt: { gt: now },
                ...(exceptSessionId ? { id: { not: exceptSessionId } } : {})
            },
            data: { revokedAt: now, revokedReason: reason },
            select: { id: true }
        })
        return revoked.map((session) => session.id)
    }

    async revokeForDeletedAccounts(now: Date): Promise<string[]> {
        const revoked = await this.prisma.session.updateManyAndReturn({
            where: { revokedAt: null, user: { deletedAt: { not: null } } },
            data: { revokedAt: now, revokedReason: 'account-deleted' satisfies RevokeReason },
            select: { id: true }
        })
        return revoked.map((session) => session.id)
    }

    async deleteEnded(before: Date): Promise<number> {
        const result = await this.prisma.session.deleteMany({
            where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] }
        })
        return result.count
    }
}
