import { DomainError } from '@/shared/domain/domain-error'

/** Bigger than 25 MB (REQ-MSG-04). The storage refuses a bigger upload too (D-165). */
export class AttachmentTooLargeError extends DomainError {
    readonly kind = 'too_large'
    readonly errorKey = 'UPLOAD_FILE_TOO_LARGE'

    constructor() {
        super('A file can be at most 25 MB')
    }
}

/**
 * A type not sent (D-92, D-177), or, at `/complete`, content that is not what
 * the name says: the file is deleted (D-93).
 */
export class AttachmentTypeError extends DomainError {
    readonly kind = 'unsupported_type'
    readonly errorKey = 'UPLOAD_INVALID_TYPE'

    constructor(filename: string) {
        super(`This type of file cannot be sent, or its content is not what its name says: ${filename}`)
    }
}

/** A name with nothing left once folders and control characters are taken out, or too long. */
export class AttachmentNameError extends DomainError {
    readonly kind = 'unprocessable'
    readonly errorKey = 'VALIDATION_ERROR'

    constructor() {
        super('A file needs a name of 1 to 255 characters')
    }
}

/**
 * No such upload of the person's, or nothing reached the storage under it
 * yet, or (sending) a file that cannot be sent: someone else's, not checked,
 * sent before, or cleaned up after 24 hours. `attachmentIds` says which, so
 * the client uploads those again (S-CHAT-04).
 */
export class AttachmentNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'UPLOAD_FILE_NOT_FOUND'
    readonly details: { attachmentIds: string[] }

    constructor(attachmentIds: string[]) {
        super(`Files not found: ${attachmentIds.join(', ')}`)
        this.details = { attachmentIds }
    }
}

/** Files in a channel where the person may not send them (no ATTACH_FILES, REQ-ROLE-03). */
export class CannotAttachError extends DomainError {
    readonly kind = 'forbidden'
    readonly errorKey = 'FORBIDDEN'

    constructor() {
        super('You cannot send files in this channel')
    }
}

/** Too many files being checked at once: try again shortly (the client's "Thử lại"). */
export class FileCheckBusyError extends DomainError {
    readonly kind = 'unavailable'
    readonly errorKey = 'SERVICE_UNAVAILABLE'

    constructor() {
        super('Too many files are being checked right now. Please try again shortly.')
    }
}
