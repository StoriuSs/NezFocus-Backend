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
