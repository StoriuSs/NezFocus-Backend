import { DomainError } from '@/shared/domain/domain-error'

/** No request of theirs to accept: it was cancelled or declined meanwhile (D-237, "Lời mời không còn hiệu lực"). */
export class FriendRequestNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'

    constructor(userId: string) {
        super(`No friend request from ${userId} to accept`)
    }
}

/**
 * One of the two blocked the other (REQ-SOCIAL-03, D-242): no request, no
 * message, no call between them, either way. The same answer for every
 * reason a person cannot be reached (REQ-SOCIAL-04), DMs and calls included.
 */
export class CannotMessageUserError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'CANNOT_MESSAGE_USER'

    constructor(userId: string) {
        super(`Cannot reach user ${userId}`)
    }
}

/** My request to them is still waiting (REQ-SOCIAL-01). */
export class FriendRequestPendingError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'FRIEND_REQUEST_PENDING'

    constructor(userId: string) {
        super(`A friend request to ${userId} is already waiting`)
    }
}

/** We are friends already (REQ-SOCIAL-01). */
export class AlreadyFriendsError extends DomainError {
    readonly kind = 'conflict'
    readonly errorKey = 'ALREADY_FRIENDS'

    constructor(userId: string) {
        super(`Already friends with ${userId}`)
    }
}

/**
 * The day's 50 requests are used up (REQ-SOCIAL-01, D-242): 429 with
 * `data.reason = "friend_requests"`, `Retry-After` up to the sender's midnight.
 */
export class FriendRequestLimitError extends DomainError {
    readonly kind = 'rate_limited'
    readonly errorKey = 'RATE_LIMIT_EXCEEDED'
    readonly details = { reason: 'friend_requests' }

    constructor(readonly retryAfterSeconds: number) {
        super(`Too many friend requests today. Try again in ${retryAfterSeconds} seconds.`)
    }
}
