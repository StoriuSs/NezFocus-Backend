import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MembershipSnapshot } from '../../domain'
import { membershipSelect, toMembership } from './membership.selections'

/**
 * The advisory lock that serialises everything adding a server to one
 * person's list — creating one, joining one (PrismaInviteRepository) — so the count of their
 * servers cannot change between reading it and acting on it. Scoped to the
 * transaction (released at commit or rollback), and this module's own concern
 * rather than a lock on the users module's row.
 */
// Taken before any Server row lock (InviteRepositoryPort.join).
export const membershipsLock = (userId: string) => `server-memberships:${userId}`

/** The client a Prisma transaction callback is given, for the helpers that run inside one. */
export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

/**
 * Locks the live server's row (FOR UPDATE, the lock every change to its
 * channels, roles and members takes, D-149) and reads the person acting.
 * Null when the server is gone or they are not in it.
 */
export async function lockMembership(tx: Tx, serverId: string, userId: string): Promise<MembershipSnapshot | null> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Server" WHERE "id" = ${serverId} AND "deletedAt" IS NULL FOR UPDATE
    `
    if (locked.length === 0) return null
    const row = await tx.member.findUnique({
        where: { serverId_userId: { serverId, userId } },
        select: membershipSelect
    })
    return row ? toMembership(row) : null
}
