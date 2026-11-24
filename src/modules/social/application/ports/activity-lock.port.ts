/**
 * Activity Lock Port — one person's activity line told one at a time (D-247
 * L5-e): reading it and sending it run while their lock is held, so of two
 * changes told at once the second reads after the first went out, and the
 * last line anyone hears is the one now. Across app instances (Postgres
 * advisory locks).
 */
export interface ActivityLockPort {
    /**
     * `work` while holding the lock of each of `userIds` (taken in one order,
     * so two never wait on each other). Throws when no place among the lock
     * holders comes in time: nothing is told, and the next change tells again.
     */
    whileHeld<T>(userIds: string[], work: () => Promise<T>): Promise<T>
}

export const ACTIVITY_LOCK = Symbol('ActivityLockPort')
