import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants/error-response'

/** What went wrong, in domain terms. The HTTP layer maps it to a status. */
export type DomainErrorKind =
    | 'invalid'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'unprocessable'
    | 'rate_limited'
    /** Something the answer depends on could not be reached; try again later. */
    | 'unavailable'

/** A key present in both ERROR_CODES and ERROR_TYPES. */
export type ErrorKey = keyof typeof ERROR_CODES & keyof typeof ERROR_TYPES

/**
 * Base class for errors a module's domain or application layer throws.
 *
 * Framework-free: an error states its kind and which catalogued error it is,
 * nothing about HTTP. DomainExceptionFilter turns any subclass into the API's
 * error envelope, so a new module adds error classes and nothing else — no
 * filter of its own to write and register.
 */
export abstract class DomainError extends Error {
    abstract readonly kind: DomainErrorKind
    abstract readonly errorKey: ErrorKey
    /** For `rate_limited`: when the caller may try again. Sent as Retry-After. */
    readonly retryAfterSeconds?: number
    /**
     * Facts a client can act on, beyond the message: which password rules
     * were broken, say. Added to the envelope's `data`. Never user data.
     */
    readonly details?: Record<string, unknown>

    constructor(message: string) {
        super(message)
        this.name = new.target.name
    }
}
