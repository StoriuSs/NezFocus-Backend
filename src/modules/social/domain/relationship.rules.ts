/*
 * Friends and blocks between two people (REQ-SOCIAL-01, REQ-SOCIAL-03,
 * D-237, D-242): what each action does to where the pair stands, decided
 * here on what the transaction read under the pair's lock, so a test can
 * walk every case without a database.
 */

/** The most a note sent with a request by username may hold (REQ-SOCIAL-01). */
export const NOTE_MAX_LENGTH = 150

/** How many requests a person may send in a day of their own time zone (REQ-SOCIAL-01). */
export const FRIEND_REQUESTS_PER_DAY = 50

/** Where two people stand, as one of them sees it; stored as one row of the pair, or none. */
export type Standing = 'none' | 'outgoing' | 'incoming' | 'friend'

/** What the client is told of a person (D-242): `blocked` when I blocked them, whatever else is stored. */
export type RelationshipType = Standing | 'blocked'

/** Every RelationshipType, for the API's list of values. */
export const RELATIONSHIP_TYPES: readonly RelationshipType[] = ['friend', 'incoming', 'outgoing', 'blocked', 'none']

/**
 * The pair as one of them sees it: their relationship and the blocks each
 * way. Someone who blocked me is not told to me (REQ-SOCIAL-03: "B không
 * được báo"): only `blockedBy` knows it, and nothing shows it.
 */
export interface PairState {
    standing: Standing
    /** I blocked them. */
    blocking: boolean
    /** They blocked me. */
    blockedBy: boolean
}

/** Strangers, neither blocking the other. */
export const NO_RELATIONSHIP: PairState = { standing: 'none', blocking: false, blockedBy: false }

const FLIPPED: Record<Standing, Standing> = {
    none: 'none',
    outgoing: 'incoming',
    incoming: 'outgoing',
    friend: 'friend'
}

/** The same pair as the other one sees it. */
export const flip = ({ standing, blocking, blockedBy }: PairState): PairState => ({
    standing: FLIPPED[standing],
    blocking: blockedBy,
    blockedBy: blocking
})

/** What I see of them: blocked once I blocked them; never that they blocked me. */
export const shownType = ({ standing, blocking }: PairState): RelationshipType => (blocking ? 'blocked' : standing)

/**
 * What a person asks for: a request by username (with a note; asking again
 * is an error, REQ-SOCIAL-01) or from a profile (no note; asking again
 * changes nothing, D-237); accepting a request; removing the relationship
 * (declining, cancelling, unfriending: one route, D-237); blocking;
 * unblocking.
 */
export type RelationshipAction =
    | { kind: 'request'; from: 'username' | 'profile'; note: string | null }
    | { kind: 'accept' }
    | { kind: 'remove' }
    | { kind: 'block' }
    | { kind: 'unblock' }

/** What to write: a new request by me, their request accepted, the row deleted, a block added or taken off, or nothing. */
export type RelationshipWrite =
    | { write: 'request'; note: string | null }
    | { write: 'accept' }
    | { write: 'remove' }
    | { write: 'block' }
    | { write: 'unblock' }
    | { write: 'nothing' }

/**
 * Why an action is refused: a block either way (CANNOT_MESSAGE_USER, D-242);
 * my request still waiting (FRIEND_REQUEST_PENDING); friends already
 * (ALREADY_FRIENDS); no request of theirs to accept (D-237: not found); the
 * day's requests used up (RATE_LIMIT_EXCEEDED).
 */
export type RelationshipRefusal = 'blocked' | 'pending' | 'friends' | 'no_request' | 'limit'

export type RelationshipDecision = RelationshipWrite | { refused: RelationshipRefusal }

/**
 * What `action` by one of the pair does, on the pair as they see it.
 * `mayRequest`: whether a new request fits in their day (FRIEND_REQUESTS_PER_DAY);
 * answering a request of theirs is not a new one and always may.
 *
 * - A request: refused by a block either way; theirs waiting → accepted
 *   (asking each other makes friends); mine waiting or friends → refused by
 *   username, nothing from a profile; else a new request, when the day allows.
 * - Accepting: their request waiting → accepted; friends already → nothing
 *   (another tab answered first); else refused (D-237).
 * - Removing: whatever the row is, deleted; none → nothing.
 * - Blocking: the row deleted and the block added; blocked already → nothing.
 * - Unblocking: the block taken off; none → nothing.
 */
export function decideRelationship(
    state: PairState,
    action: RelationshipAction,
    mayRequest: boolean
): RelationshipDecision {
    switch (action.kind) {
        case 'request': {
            if (state.blocking || state.blockedBy) return { refused: 'blocked' }
            if (state.standing === 'incoming') return { write: 'accept' }
            const again = action.from === 'profile'
            if (state.standing === 'outgoing') return again ? { write: 'nothing' } : { refused: 'pending' }
            if (state.standing === 'friend') return again ? { write: 'nothing' } : { refused: 'friends' }
            return mayRequest ? { write: 'request', note: action.note } : { refused: 'limit' }
        }
        case 'accept':
            if (state.standing === 'incoming') return { write: 'accept' }
            return state.standing === 'friend' ? { write: 'nothing' } : { refused: 'no_request' }
        case 'remove':
            return state.standing === 'none' ? { write: 'nothing' } : { write: 'remove' }
        case 'block':
            return state.blocking ? { write: 'nothing' } : { write: 'block' }
        case 'unblock':
            return state.blocking ? { write: 'unblock' } : { write: 'nothing' }
    }
}

/** The pair, as the one who acted sees it, after `write`. */
export function afterWrite(state: PairState, write: RelationshipWrite): PairState {
    switch (write.write) {
        case 'request':
            return { ...state, standing: 'outgoing' }
        case 'accept':
            return { ...state, standing: 'friend' }
        case 'remove':
            return { ...state, standing: 'none' }
        case 'block':
            return { ...state, standing: 'none', blocking: true }
        case 'unblock':
            return { ...state, blocking: false }
        case 'nothing':
            return state
    }
}

/** How a person's list changed (`relationship.*`, SRS 5.2): a new entry, a changed one, one gone, or none. */
export type ListChange = 'added' | 'updated' | 'removed' | null

/**
 * How what one of the pair sees changed, from `before` to `after` (both as
 * they see it). Someone blocked sees only the relationship go (D-242).
 */
export function listChange(before: PairState, after: PairState): ListChange {
    const was = shownType(before)
    const is = shownType(after)
    if (was === is) return null
    if (was === 'none') return 'added'
    return is === 'none' ? 'removed' : 'updated'
}

/** Whether a request between the two was waiting before and is no longer (its inbox item goes, REQ-NOTIF-03). */
export const requestClosed = (before: PairState, after: PairState): boolean =>
    (before.standing === 'incoming' || before.standing === 'outgoing') && after.standing !== before.standing

/** A note as kept: trimmed, and none when empty. */
export function keptNote(note: string | null | undefined): string | null {
    const trimmed = note?.trim() ?? ''
    return trimmed === '' ? null : trimmed
}
