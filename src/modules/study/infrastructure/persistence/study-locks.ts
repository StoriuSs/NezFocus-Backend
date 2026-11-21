/**
 * The advisory lock held while a room's session starts, and while someone
 * joining or leaving the room is written to it (M5 L3b): a join read before
 * the session is written waits, then finds it; one read after is among the
 * people the start reads. Taken first, before the session row and the
 * study-counts locks (D-224). Scoped to the transaction.
 */
export const studyRoomLock = (channelId: string) => `study-room:${channelId}`
