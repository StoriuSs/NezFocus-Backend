import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'

/** The client a Prisma transaction callback is given, for the helpers that run inside one. */
export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

/** A pair with the smaller id first, as its rows are kept (Relationship_pair_check: byte order, COLLATE "C"). */
export const orderedPair = (a: string, b: string): { low: string; high: string } =>
    a < b ? { low: a, high: b } : { low: b, high: a }

/**
 * The advisory lock held while a pair's relationship or blocks change
 * (D-242): two of them acting on each other at once (a request each way, an
 * accept while the other cancels) take turns, the second reading what the
 * first wrote. Scoped to the transaction.
 */
export const pairLock = (low: string, high: string) => `relationship:${low}:${high}`

/** Takes pairLock in `tx`, waiting while another transaction holds it. */
export async function lockPair(tx: Tx, low: string, high: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pairLock(low, high)}, 0))`
}

/**
 * The advisory lock held while a person's calls change (D-242): by person,
 * not by DM, as being busy is a person's (a call in one DM makes them busy
 * in every other). Scoped to the transaction.
 */
export const callLock = (userId: string) => `call:${userId}`

/**
 * Takes callLock of each of `userIds`, smaller id first (byte order, as
 * pairs are kept): two commands about the same people always lock in the
 * same order, so they wait for each other and never deadlock.
 */
export async function lockCallers(tx: Tx, userIds: string[]): Promise<void> {
    const ordered = [...new Set(userIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const userId of ordered) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${callLock(userId)}, 0))`
    }
}
