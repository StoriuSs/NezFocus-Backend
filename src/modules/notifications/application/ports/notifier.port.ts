import { MessageMentionSources, MessagePlace } from '../../domain'

/** A message just sent or edited, and whom it is about (REQ-MSG-09). */
export interface MessageNotice extends MessagePlace {
    /** When it was sent: one older than the inbox keeps gets no new items on an edit. */
    sentAt: Date
    sources: MessageMentionSources
    /** Those of its people who had read the channel past it when it was saved: their items are made read (D-199). */
    readerIds: string[]
}

/**
 * Notifier Port — how other modules put items in people's inboxes (D-185):
 * the only way in, so the rules every item follows are in one place (never
 * for the one who acted, nothing in a DM). Defined and answered by this
 * module, given by the global NotifierModule, so a module this one reads
 * from (messaging, D-198) can call it without importing it. Each call
 * resolves once the items are written; the caller runs it after its own
 * write is committed.
 */
export interface NotifierPort {
    /** A message sent or edited: one item for each person it mentions or answers now, none for the others (D-183, D-188). */
    messageMentions(notice: MessageNotice): Promise<void>

    /** Messages of one channel deleted: their items go (REQ-NOTIF-03). */
    messagesDeleted(channelId: string, messageIds: string[]): Promise<void>

    /** Someone read a channel up to a message: its mention and reply items up to it are read (D-188). */
    channelRead(userId: string, channelId: string, messageId: string): Promise<void>
}

export const NOTIFIER = Symbol('NotifierPort')
