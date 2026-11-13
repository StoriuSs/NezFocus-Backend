/** Whom a ticket was sold to: the person and the session that bought it. */
export interface TicketHolder {
    userId: string
    sessionId: string
}

/**
 * Ticket Store Port — the short-lived tickets a socket connects with (D-13),
 * so the access token never sits in a URL.
 */
export interface TicketStorePort {
    /**
     * A new, unguessable ticket for `holder`, spendable once within
     * TICKET_TTL_SECONDS.
     * @throws TicketsUnavailableError when the store cannot be reached
     */
    issue(holder: TicketHolder): Promise<string>

    /**
     * Spends a ticket: its holder, or null when it is unknown, spent or out of
     * time. Two sockets offering the same ticket at once: only one gets it.
     * @throws TicketsUnavailableError when the store cannot be reached
     */
    redeem(ticket: string): Promise<TicketHolder | null>
}

export const TICKET_STORE = Symbol('TicketStorePort')
