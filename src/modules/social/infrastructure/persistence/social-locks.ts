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
