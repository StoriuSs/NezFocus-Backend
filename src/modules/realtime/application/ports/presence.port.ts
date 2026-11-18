import type { Presence } from '@/modules/realtime/domain'

/**
 * Presence Port — what other modules may read of presence (REQ-AUTH-07):
 * what others see of everyone not offline, which messaging reads for @here
 * (D-166); whether someone has a tab open, which notifications reads to know
 * whether a kick or ban was seen in its dialog (D-187).
 *
 * Never throws: while presence cannot be read, nobody is online (an @here
 * reaches no one, D-174) and no one has a tab open.
 */
export interface PresencePort {
    /** User id → what others see, for everyone not offline; an invisible person is left out. */
    everyoneShown(): Promise<Map<string, Presence>>

    /** Whether the person has at least one tab connected now, even one shown as invisible. */
    connected(userId: string): Promise<boolean>
}

export const PRESENCE = Symbol('PresencePort')
