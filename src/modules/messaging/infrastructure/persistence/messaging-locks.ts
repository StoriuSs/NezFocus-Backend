/**
 * The advisory lock that serialises pinning in one channel, so its count of
 * pins cannot change between reading it and adding one (50, REQ-MSG-07).
 * Scoped to the transaction (released at commit or rollback). messaging does
 * not lock the servers module's Channel row for this (plan M2 L1).
 */
export const pinsLock = (channelId: string) => `channel-pins:${channelId}`
