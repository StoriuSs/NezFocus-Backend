/**
 * The advisory lock that serialises pinning in one channel, so its count of
 * pins cannot change between reading it and adding one (50, REQ-MSG-07).
 * Scoped to the transaction (released at commit or rollback). The count rests
 * on this lock only: the FOR KEY SHARE that pinning takes on the Channel row
 * just orders it before a channel delete (ARCHITECTURE 2.1).
 */
export const pinsLock = (channelId: string) => `channel-pins:${channelId}`
