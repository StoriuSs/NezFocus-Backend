/** Someone a message mentions, as its chip names them (D-171). */
export interface PreviewPerson {
    id: string
    username: string | null
    displayName: string | null
}

/** A message as an inbox item shows it, now (spec 06 › Luật hộp thư): its text as written, the names its mentions stand for, its files. */
export interface MessagePreview {
    id: string
    content: string
    mentionUsers: PreviewPerson[]
    mentionRoles: { id: string; name: string }[]
    files: { count: number; images: number }
}

/**
 * Message Previews Port — what this module reads of messages (D-184, D-198).
 * Defined here, answered by messaging through its global
 * MessagePreviewsModule: messaging calls NOTIFIER, so this module cannot
 * import it.
 */
export interface MessagePreviewsPort {
    /** The messages still there, in no order; a deleted one is left out. One read for a whole page. */
    previewsOf(messages: { id: string; serverId: string }[]): Promise<MessagePreview[]>
}

export const MESSAGE_PREVIEWS = Symbol('MessagePreviewsPort')
