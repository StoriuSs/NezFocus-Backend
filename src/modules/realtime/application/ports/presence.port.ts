import type { Presence } from '@/modules/realtime/domain'

/**
 * Presence Port — what other modules may read of presence (REQ-AUTH-07):
 * what others see of everyone not offline. Messaging reads it for @here
 * (D-166).
 *
 * Never throws: while presence cannot be read, nobody is online (an @here
 * reaches no one, D-174).
 */
export interface PresencePort {
    /** User id → what others see, for everyone not offline; an invisible person is left out. */
    everyoneShown(): Promise<Map<string, Presence>>
}

export const PRESENCE = Symbol('PresencePort')
