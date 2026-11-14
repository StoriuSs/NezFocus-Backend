import { MessageMentions } from '../mention.rules'

/** Who wrote a message, as the chat shows them. */
export interface MessageAuthor {
    id: string
    /** Null once the account's personal data is erased (REQ-AUTH-09): the chat says "deleted account". */
    username: string | null
    displayName: string | null
    /** The stored picture's key; the application turns it into an address. */
    avatarKey: string | null
}

/**
 * The message a reply answers, as its reply line shows it (C-10 `reply`).
 * Once that message is deleted, only its id is left: the line says "the
 * original message was deleted" (REQ-MSG-05).
 */
export interface RepliedMessage {
    id: string
    /** Null once deleted. */
    author: MessageAuthor | null
    /** Empty once deleted. */
    content: string
    deleted: boolean
    /** The roles it mentions in effect and the people its tokens name, as on a message; none once deleted (D-171). */
    mentionRoleIds: string[]
    mentionUsers: MessageAuthor[]
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
    /** The message this one answers; null if none, or if that one was removed for good with its channel. */
    replyTo: RepliedMessage | null
    /** In the channel's pins (REQ-MSG-07): the same for everyone, so events carry it. */
    pinned: boolean
    /**
     * Whom a system message is about (`systemData.userId`, D-168), read like
     * an author (names null once erased, REQ-AUTH-09); null on a regular message, or one naming no one.
     */
    systemUser: MessageAuthor | null
    /** @everyone, in effect (REQ-MSG-03). */
    mentionEveryone: boolean
    /** The roles mentioned in effect, in the order written (schema). */
    mentionRoleIds: string[]
    /**
     * The people its <@id> tokens name, in the order written, read as they
     * are now (D-171): anyone the text names, whether or not they could
     * see the channel; an id of no account is left out.
     */
    mentionUsers: MessageAuthor[]
    editedAt: Date | null
    createdAt: Date
}

/** A message found by id, deleted or not: a reply may still answer a deleted one (REQ-MSG-05). */
export interface StoredMessage extends MessageRecord {
    deleted: boolean
}

export interface NewMessage {
    channelId: string
    authorId: string
    content: string
    nonce: string
    /** A regular message of the same channel, checked by the application (the database cannot, schema). */
    replyToId: string | null
    /** Decided by the application (`decideMentions`), those who cannot see the channel left out. */
    mentions: MessageMentions
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
     * database keeps (authorId, nonce) unique. `deleted`: the one that came
     * back was deleted since.
     */
    create(message: NewMessage): Promise<{ message: MessageRecord; created: boolean; deleted: boolean }>
    /** The message this author sent with this nonce, in any channel, deleted or not; null if none. */
    findByNonce(authorId: string, nonce: string): Promise<StoredMessage | null>
    /** The message with this id, deleted ones included; null if there is none. */
    find(id: string): Promise<StoredMessage | null>
    /**
     * Replace the text of a message not deleted, marked edited at `at`, and
     * what it mentions with it (its mention rows written again, D-164); null
     * if it is deleted (or gone) by now.
     */
    edit(id: string, content: string, mentions: MessageMentions, at: Date): Promise<MessageRecord | null>
    /**
     * Delete a message, keeping its row for the replies to it (schema): in
     * one transaction its text and mentions are emptied, its mention rows,
     * reactions and pin removed, its files let go for the clean-up. False if
     * it was deleted (or gone) already.
     */
    remove(id: string, at: Date): Promise<boolean>
    /** Up to `limit` messages of the channel from `cursor`; `around` splits them half before, half from the id on. */
    page(channelId: string, cursor: MessageCursor, limit: number): Promise<MessagePage>
}

export const MESSAGE_REPOSITORY = Symbol('MessageRepositoryPort')
