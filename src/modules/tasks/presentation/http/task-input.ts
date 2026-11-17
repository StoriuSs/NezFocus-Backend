/** A due date as sent: an ISO time, null for none, left out for no change. */
export const dueAtOf = (value: string | null | undefined): Date | null | undefined =>
    value === undefined ? undefined : value === null ? null : new Date(value)
