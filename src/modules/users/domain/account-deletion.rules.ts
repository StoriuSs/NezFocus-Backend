const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long an account waits between its owner asking to delete it and being
 * deleted (REQ-AUTH-09, D-141). Meanwhile signing in offers to restore it.
 */
export const DELETION_WAIT_MS = 14 * DAY_MS

/**
 * How long an account may stay incomplete, counted from when it was made,
 * before it is deleted (REQ-AUTH-01, D-141). It holds only an address (and a
 * name from Google): coming back with a code makes a new one, nothing lost.
 */
export const INCOMPLETE_ACCOUNT_MS = 14 * DAY_MS

/** When an account its owner asked to delete at `requestedAt` is deleted. */
export function deletesAt(requestedAt: Date): Date {
    return new Date(requestedAt.getTime() + DELETION_WAIT_MS)
}

/**
 * Which accounts the sweep at `now` deletes: those asked to be deleted at or
 * before `requestedBy`, and those still incomplete that were made at or
 * before `incompleteSince`.
 */
export function dueForDeletion(now: Date): { requestedBy: Date; incompleteSince: Date } {
    return {
        requestedBy: new Date(now.getTime() - DELETION_WAIT_MS),
        incompleteSince: new Date(now.getTime() - INCOMPLETE_ACCOUNT_MS)
    }
}
