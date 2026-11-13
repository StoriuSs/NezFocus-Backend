/** Who wrote a message, as the chat shows them. */
export interface MessageAuthor {
    id: string
    /** Null once the account's personal data is erased (REQ-AUTH-09): the chat says "deleted account". */
    username: string | null
    displayName: string | null
    /** The stored picture's key; the application turns it into an address. */
    avatarKey: string | null
}

/** A message as the chat reads it. */
export interface MessageRecord {
    id: string
    channelId: string
    type: 'regular' | 'system'
    /** Null on a system message (D-168). */
    author: MessageAuthor | null
    content: string
    /** What a system message reports, and whom it is about (D-168); null on a regular one. */
    systemEvent: string | null
    systemData: Record<string, unknown> | null
    editedAt: Date | null
    createdAt: Date
}

export interface NewMessage {
    channelId: string
    authorId: string
    content: string
    nonce: string
}

/**
 * Where a history page starts (SRS 5.1, D-48), ids compared as times
 * (UUIDv7, ARCHITECTURE 2.4):
 * - `latest`: the newest messages;
 * - `before` / `after`: strictly older / newer than that id;
 * - `around`: that id and the messages on both sides of it, whether or not
 *   it still exists (a link to a deleted message opens near where it was).
 */
export type MessageCursor =
    | { kind: 'latest' }
    | { kind: 'before'; id: string }
    | { kind: 'after'; id: string }
    | { kind: 'around'; id: string }

/** A page of history, oldest first, and whether there is more on each side. */
export interface MessagePage {
    items: MessageRecord[]
    hasMoreBefore: boolean
    hasMoreAfter: boolean
}

/** The messages of channels: the only module that writes them (ARCHITECTURE 9). */
export interface MessageRepositoryPort {
    /**
     * Save a message, unless its author already sent one with this nonce
     * (REQ-MSG-10): then that one comes back, and `created` is false. Two
     * sends of one nonce at once make one message either way, as the
     * database keeps (authorId, nonce) unique.
     */
    create(message: NewMessage): Promise<{ message: MessageRecord; created: boolean }>
    /** The message this author sent with this nonce, in any channel; null if none. */
    findByNonce(authorId: string, nonce: string): Promise<MessageRecord | null>
    /** Up to `limit` messages of the channel from `cursor`; `around` splits them half before, half from the id on. */
    page(channelId: string, cursor: MessageCursor, limit: number): Promise<MessagePage>
}

export const MESSAGE_REPOSITORY = Symbol('MessageRepositoryPort')
