/**
 * The participant attribute a join token carries: the sign-in session that
 * asked for it (D-214). Read back from LiveKit's webhooks and its list of
 * participants, so the session's end can put out the connection it made.
 */
export const SESSION_ATTRIBUTE = 'session_id'

/** The session a participant's token was issued to; null for a token from before the attribute. */
export const sessionOf = (participant: { attributes?: Record<string, string> }): string | null =>
    participant.attributes?.[SESSION_ATTRIBUTE] || null
