/**
 * Unread messages and mentions are counted per channel up to this many
 * (D-173): enough to show "99+", and each count reads at most this many rows.
 */
export const READ_COUNT_CAP = 100

/**
 * Where someone who never read a channel stands in it (D-170): just before
 * the first message that could have been sent when they joined the server.
 * Messages before that read as read, the rest as new. Ids are UUIDv7, whose
 * first 48 bits are the time in milliseconds, so this is the id of that
 * millisecond with every other bit as small as a UUIDv7 allows; no message
 * has exactly these bits.
 */
export function readFloor(joinedAt: Date): string {
    const time = joinedAt.getTime().toString(16).padStart(12, '0')
    return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-000000000000`
}
