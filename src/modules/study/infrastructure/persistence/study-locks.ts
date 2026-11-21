import type { Tx } from './study-counts'

/**
 * The advisory lock held while a room's session starts, and while someone
 * joining or leaving the room is written to it (M5 L3b): a join read before
 * the session is written waits, then finds it; one read after is among the
 * people the start reads. Taken first, before the session row and the
 * study-counts locks (D-224). Scoped to the transaction.
 */
export const studyRoomLock = (channelId: string) => `study-room:${channelId}`

/** Takes studyRoomLock in `tx`, waiting while another transaction holds it. */
export async function lockStudyRoom(tx: Tx, channelId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${studyRoomLock(channelId)}, 0))`
}
