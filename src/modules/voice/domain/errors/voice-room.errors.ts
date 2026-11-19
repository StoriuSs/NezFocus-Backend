import { DomainError } from '@/shared/domain/domain-error'

/**
 * No such voice room, its server is gone, the person is not a member, or
 * they may not view it: the same answer for all (NFR-SEC-05).
 */
export class VoiceRoomNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(channelId: string) {
        super(`Voice room not found: ${channelId}`)
    }
}

/** The person sees the room but may not join it: no CONNECT (REQ-VC-01). */
export class CannotConnectError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('You cannot join this voice room')
    }
}

/** Timed out in the server (REQ-ROLE-04, D-210): no voice room until `timeoutUntil`. */
export class VoiceTimedOutError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'MEMBER_TIMED_OUT'
    readonly details: { timeoutUntil: string }

    constructor(timeoutUntil: Date) {
        super(`You are timed out until ${timeoutUntil.toISOString()}`)
        this.details = { timeoutUntil: timeoutUntil.toISOString() }
    }
}

/** The person a moderator acts on is not in that room (any more): they left, or never came (D-212). */
export class VoiceParticipantNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(channelId: string, userId: string) {
        super(`Not in voice room ${channelId}: ${userId}`)
    }
}

/** Muting or putting people out of a room one sees without MUTE_MEMBERS / MOVE_MEMBERS there (REQ-VC-04). */
export class CannotModerateRoomError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor(permission: 'MUTE_MEMBERS' | 'MOVE_MEMBERS') {
        super(`You need ${permission} in this voice room`)
    }
}

/**
 * The person ranks level with or above the moderator, or is them
 * (REQ-VC-04, D-207): as a kick, only someone strictly below one's highest
 * role, never the owner.
 */
export class VoiceHierarchyError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'ROLE_HIERARCHY_VIOLATION'

    constructor() {
        super('Only members below your highest role can be muted or put out')
    }
}
