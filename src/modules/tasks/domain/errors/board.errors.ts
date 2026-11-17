import { DomainError } from '@/shared/domain/domain-error'

/**
 * No such text channel, its server is gone, the person is not a member, or
 * they may not view it: the same answer for all (NFR-SEC-05).
 */
export class ChannelNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(channelId: string) {
        super(`Channel not found: ${channelId}`)
    }
}

/**
 * The channel's Task Board is off (REQ-TASK-01): its tasks are hidden and
 * nothing can be done to them until it is on again. The reason lets the
 * client say so rather than "you may not" (S-TASK-03).
 */
export class TaskBoardDisabledError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'
    readonly details = { reason: 'task_board_disabled' }

    constructor() {
        super('The Task Board of this channel is off')
    }
}

/** Timed out in the server (REQ-ROLE-04, D-188): tasks are for viewing only, until `timeoutUntil`. */
export class TaskTimedOutError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'MEMBER_TIMED_OUT'
    readonly details: { timeoutUntil: string }

    constructor(timeoutUntil: Date) {
        super(`You are timed out until ${timeoutUntil.toISOString()}`)
        this.details = { timeoutUntil: timeoutUntil.toISOString() }
    }
}
