/**
 * The advisory lock every change to one person's VoiceState row takes
 * (D-210): a webhook, the reconciliation and the person's own request read
 * the row and decide on it one at a time. Scoped to the transaction
 * (released at commit or rollback).
 */
export const voiceStateLock = (userId: string) => `voice-state:${userId}`

/**
 * The advisory lock held while a room's list is read and told
 * (`voice_state.updated`, D-205): the lists of one room are told in the
 * order they were read, so an older one never replaces a newer one. Taken
 * alone, never with a person's lock.
 */
export const voiceRoomLock = (channelId: string) => `voice-room:${channelId}`
