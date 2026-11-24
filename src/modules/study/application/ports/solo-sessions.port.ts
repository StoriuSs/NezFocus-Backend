import type { FocusPhase } from '../../domain'

/** Someone's Solo not yet ended (REQ-STUDY-05), as their activity line needs it (D-247). */
export interface SoloState {
    userId: string
    status: 'running' | 'paused' | 'waiting'
    phase: FocusPhase
    /** While running only. */
    phaseEndsAt: Date | null
}

/**
 * Solo Sessions Port — the Solo of each person, for the social module's
 * study activity line (D-240, D-247), which a friend or someone in a shared
 * server sees. Answered by this module from its own table; social imports
 * this module, so the code depends one way only. Only where each Solo is:
 * how a session moves stays this module's.
 */
export interface SoloSessionsPort {
    /** The Solo not yet ended of those of these people who have one, in no order. One read for them all. */
    solosOf(userIds: string[]): Promise<SoloState[]>
}

export const SOLO_SESSIONS = Symbol('SoloSessionsPort')
