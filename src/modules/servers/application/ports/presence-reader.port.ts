/** What others see of a member (REQ-AUTH-07); invisible shows as offline. */
export const MEMBER_PRESENCES = ['online', 'idle', 'dnd', 'offline'] as const
export type MemberPresence = (typeof MEMBER_PRESENCES)[number]

/**
 * Presence Reader Port — what others see of everyone not offline, for the
 * member list (D-175) and an invite's online count. Presence is the
 * realtime module's, and realtime imports this module: realtime answers this
 * port through a small global module (as D-160), so the code depends one
 * way only.
 *
 * Never throws: while presence cannot be read, nobody is online (D-174).
 */
export interface PresenceReaderPort {
    /** User id → what others see, for everyone not offline. */
    everyoneShown(): Promise<Map<string, MemberPresence>>
}

export const PRESENCE_READER = Symbol('PresenceReaderPort')
