import { firstIdAt } from './message.rules'

/**
 * Unread messages and mentions are counted per channel up to this many
 * (D-173): enough to show "99+", and each count reads at most this many rows.
 */
export const READ_COUNT_CAP = 100

/**
 * Where someone who never read a channel stands in it (D-170): just before
 * the first message that could have been sent when they joined the server.
 * Messages before that read as read, the rest as new.
 */
export function readFloor(joinedAt: Date): string {
    return firstIdAt(joinedAt)
}
