import type { FileType } from '../../domain'

/** A form the browser posts the file with, straight to the storage (D-165). */
export interface UploadForm {
    url: string
    fields: Record<string, string>
}

/** An image's thumbnail as kept, and the image's own size upright (C-10 keeps its place). */
export interface Thumbnail {
    key: string
    width: number
    height: number
}

/** How a read link answers: the checked type, shown or downloaded, under the file's name. */
export interface ReadLinkOptions {
    contentType: string
    contentDisposition: string
    expiresInSeconds: number
}

/**
 * Where attachments are kept (REQ-MSG-04): uploaded by the browser itself,
 * read back here to be checked, shown through links that end.
 */
export interface AttachmentStoragePort {
    /** A form for one upload to `key`: at most `maxBytes`, for `expiresInSeconds`. */
    uploadForm(key: string, maxBytes: number, expiresInSeconds: number): Promise<UploadForm>
    /** The size of what reached `key`, or null when nothing has. */
    sizeOf(key: string): Promise<number | null>
    /** Copies `from` to `to` in the storage; false when nothing is at `from`. */
    copy(from: string, to: string): Promise<boolean>
    /** Bytes `start` to `end` (both included) of the file; fewer when it ends first. */
    read(key: string, start: number, end: number): Promise<Uint8Array>
    /**
     * A thumbnail of the image `bytes` are, kept beside it. `other-type` when
     * they decode as another image type than `type` (a PNG named .gif); null
     * when they do not decode at all (too many pixels, broken).
     */
    thumbnail(attachmentId: string, bytes: Uint8Array, type: FileType): Promise<Thumbnail | 'other-type' | null>
    readLink(key: string, options: ReadLinkOptions): Promise<string>
    delete(key: string): Promise<void>
}

export const ATTACHMENT_STORAGE = Symbol('AttachmentStoragePort')
