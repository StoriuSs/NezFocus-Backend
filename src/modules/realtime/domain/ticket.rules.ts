/**
 * How long a realtime ticket can be spent (D-13): long enough to open a
 * socket right after buying it, short enough that one copied out of a log is
 * worthless. It is spent once, whatever is left of this.
 */
export const TICKET_TTL_SECONDS = 30
