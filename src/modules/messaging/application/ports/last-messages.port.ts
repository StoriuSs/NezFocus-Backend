/** Someone a message mentions, as its text names them (D-171). */
export interface LastMessagePerson {
    id: string
    username: string | null
    displayName: string | null
}

/** The last message of a conversation, as a DM's row shows it (spec 09 › C-30 DMRow). */
export interface LastMessage {
    channelId: string
    id: string
    type: 'regular' | 'system'
    /** What a system message says happened (D-168); null for a regular one. */
    systemEvent: string | null
    /** What a system message says, as the chat has it (a call: who called, how it ended, D-250); null for a regular one. */
    systemData: Record<string, unknown> | null
    /** Null for a system message. */
    authorId: string | null
    content: string
    mentionUsers: LastMessagePerson[]
    /** An image is the one kind of file with a size. */
    files: { count: number; images: number }
    createdAt: Date
}

/**
 * Last Messages Port: what this module offers social for its list of
 * direct messages (`GET /me/dms`, D-244), answered from this module's own
 * tables: the last message not deleted of each conversation.
 */
export interface LastMessagesPort {
    /** One per channel that has a message left, in no order; one read for them all. */
    lastMessagesOf(channelIds: string[]): Promise<LastMessage[]>
}

export const LAST_MESSAGES = Symbol('LastMessagesPort')
