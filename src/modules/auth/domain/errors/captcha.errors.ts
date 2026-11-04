import { DomainError } from '@/shared/domain/domain-error'

/** This form needs a Turnstile token, and none came. */
export class CaptchaRequiredError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CAPTCHA_REQUIRED'
    constructor() {
        super('Confirm you are human, then try again.')
    }
}

export class CaptchaFailedError extends DomainError {
    readonly kind = 'invalid'
    readonly errorKey = 'AUTH_CAPTCHA_FAILED'
    constructor() {
        super('We could not confirm you are human. Try again.')
    }
}

/** Turnstile could not be asked: refused rather than let through unchecked. */
export class CaptchaUnavailableError extends DomainError {
    readonly kind = 'unavailable'
    readonly errorKey = 'AUTH_CAPTCHA_UNAVAILABLE'
    constructor() {
        super('We cannot check requests right now. Try again in a minute.')
    }
}
