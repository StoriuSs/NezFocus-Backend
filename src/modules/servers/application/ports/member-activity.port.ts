/** Where a Solo is (D-247): its phase ends at phaseEndsAt only while it runs. */
export interface MemberSoloActivity {
    status: 'running' | 'paused' | 'waiting'
    phase: 'focus' | 'short_break' | 'long_break'
    phaseEndsAt: Date | null
}

/**
 * What every viewer may see of someone's study now (D-240, D-247): the kind
 * of room they are in, and their Solo. The client adds the room's name and
 * phase when it can view the room.
 */
export interface MemberActivity {
    room: 'study' | 'voice' | null
    solo: MemberSoloActivity | null
}

/**
 * Member Activity Port — the study activity line of each member in the
 * member list (REQ-AUTH-07, D-108). Worked out by the social module, which
 * imports this module: social answers this port through a small global
 * module (as ROOM_SESSIONS), so the code depends one way only.
 */
export interface MemberActivityPort {
    /** The activity of each of these people who shows one; someone left out shows none (hidden, in a call, nowhere). */
    activitiesOf(userIds: string[]): Promise<Map<string, MemberActivity>>
}

export const MEMBER_ACTIVITY = Symbol('MemberActivityPort')
