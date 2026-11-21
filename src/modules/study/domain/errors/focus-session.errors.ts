import { DomainError } from '@/shared/domain/domain-error'

/**
 * No such room or session, its server is gone, the person is not a member,
 * or they may not view the room: the same answer for all (NFR-SEC-05).
 */
export class StudyRoomNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(id: string) {
        super(`Study room or session not found: ${id}`)
    }
}

/** The room already has a session not yet ended, or the person is in another one (REQ-STUDY-02, D-222). */
export class FocusSessionActiveError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'FOCUS_SESSION_ACTIVE'

    constructor(where: string) {
        super(`A study session is already on: ${where}`)
    }
}

/**
 * Why someone may not start or control a session (REQ-STUDY-01 to 03):
 * `not_study_room`, the voice room is no study room; `not_in_room`, a session
 * starts only from inside its room; `cannot_start`, the room lets only
 * managers start; `not_host`, only its Host or a manager controls it.
 */
export type StudyRefusal = 'not_study_room' | 'not_in_room' | 'cannot_start' | 'not_host'

/** Someone who sees the room may not do this (FORBIDDEN, the reason in `details`). */
export class StudyForbiddenError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'
    readonly details: { reason: StudyRefusal }

    constructor(reason: StudyRefusal) {
        super(`Not allowed in this study session: ${reason}`)
        this.details = { reason }
    }
}

/** Timed out in the server (REQ-ROLE-04, D-222): no session started or controlled until `timeoutUntil`. */
export class StudyTimedOutError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'MEMBER_TIMED_OUT'
    readonly details: { timeoutUntil: string }

    constructor(timeoutUntil: Date) {
        super(`You are timed out until ${timeoutUntil.toISOString()}`)
        this.details = { timeoutUntil: timeoutUntil.toISOString() }
    }
}

/** Too many sessions starting at once to start one more within the wait (SERVICE_UNAVAILABLE): try again shortly. */
export class StudyUnavailableError extends DomainError {
    readonly kind = 'unavailable'
    readonly errorKey = 'SERVICE_UNAVAILABLE'

    constructor() {
        super('Study sessions are unavailable for a moment. Try again shortly.')
    }
}

/**
 * A session rule broken (VALIDATION_ERROR, the rule in `details`):
 * `not_paused`, the cycle changes only while the session is paused
 * (REQ-STUDY-03, D-21, D-50); `study_cycle`, a cycle a study room could not
 * have (half a long break, as servers' studyCycleProblem says, with the
 * `problem`).
 */
export class SessionRuleError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'VALIDATION_ERROR'
    readonly details: { rule: 'not_paused' | 'study_cycle'; problem?: string }

    constructor(rule: 'not_paused' | 'study_cycle', problem?: string) {
        super(`Study session rule broken: ${rule}${problem ? ` (${problem})` : ''}`)
        this.details = problem ? { rule, problem } : { rule }
    }
}
