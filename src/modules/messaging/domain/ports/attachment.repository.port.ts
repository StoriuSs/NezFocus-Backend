import type { AttachmentState } from '../attachment.rules'

/** An uploaded file, sent in a message or not yet. */
export interface AttachmentRecord extends AttachmentState {
    id: string
    filename: string
    /** As asked for until `/complete`, then as kept by the storage. */
    size: number
    /** The type its content was checked to be (D-93); null until then. */
    contentType: string | null
    storageKey: string
    thumbnailKey: string | null
    /** An image's size, upright; null for any other file. */
    width: number | null
    height: number | null
    /** The channel of the message it is in; null while in none. */
    channelId: string | null
}

/** A file in a message, as the chat shows it, in the order it was sent. */
export interface MessageFile {
    id: string
    filename: string
    size: number
    contentType: string
    storageKey: string
    thumbnailKey: string | null
    width: number | null
    height: number | null
}

export interface NewAttachment {
    uploaderId: string
    filename: string
    size: number
    storageKey: string
}

/** What `/complete` learned of a file. */
export interface CheckedFile {
    size: number
    contentType: string
    thumbnailKey: string | null
    width: number | null
    height: number | null
}

/** Where a file and its thumbnail are kept. */
export interface KeptFiles {
    storageKey: string
    thumbnailKey: string | null
}

/** The files uploaded for messages (REQ-MSG-04); a message's own are written with it (MessageRepositoryPort). */
export interface AttachmentRepositoryPort {
    create(file: NewAttachment): Promise<AttachmentRecord>
    find(id: string): Promise<AttachmentRecord | null>
    findMany(ids: string[]): Promise<AttachmentRecord[]>
    /** Mark the file checked, unless it was already (two `/complete` at once): false then. */
    complete(id: string, checked: CheckedFile, at: Date): Promise<boolean>
    /** Forget an upload whose content was refused, unless it was checked meanwhile or is in a message. */
    delete(id: string): Promise<void>
    /**
     * Remove up to `limit` files no message holds: let go by a deleted
     * message, or never sent and uploaded before `uploadedBefore`. Returns
     * what they kept, for the storage to delete.
     */
    takeForCleanUp(uploadedBefore: Date, limit: number): Promise<KeptFiles[]>
}

export const ATTACHMENT_REPOSITORY = Symbol('AttachmentRepositoryPort')
