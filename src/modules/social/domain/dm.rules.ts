/**
 * Who may message whom in a DM, and when a DM shows in someone's list: pure
 * rules, no I/O (REQ-SOCIAL-04, D-238, D-242, D-244).
 */

/** What decides whether one person may message another, read for the one who would write. */
export interface MessagingFacts {
    /** The recipient's account is deleted, or waiting to be (D-182): no one writes to it. */
    gone: boolean
    /** One of the two blocked the other, either way (D-242). */
    blocked: boolean
    friends: boolean
    /** They are both members of at least one server. */
    sharesServer: boolean
    /** The recipient's "Allow messages from server members" (on by default, REQ-SOCIAL-04). */
    allowsServerMembers: boolean
}

/**
 * Whether one may message the other (REQ-SOCIAL-04): friends, or members of
 * a shared server when the recipient lets server members write; never
 * across a block, either way (REQ-SOCIAL-03, D-242), nor to an account
 * gone. Every "no" is the same answer to the client (CANNOT_MESSAGE_USER).
 * One way only: the recipient's setting is theirs, so B may be able to
 * write to A while A cannot write to B.
 */
export function mayMessage(facts: MessagingFacts): boolean {
    if (facts.gone || facts.blocked) return false
    return facts.friends || (facts.sharesServer && facts.allowsServerMembers)
}

/**
 * Whether a DM shows in one person's list (D-244): they never closed it, or
 * a message came after they did. Closing changes nothing else; opening it
 * again clears the mark.
 */
export function isShownDm(closedAt: Date | null, lastMessageAt: Date | null): boolean {
    if (!closedAt) return true
    return lastMessageAt !== null && lastMessageAt.getTime() > closedAt.getTime()
}
