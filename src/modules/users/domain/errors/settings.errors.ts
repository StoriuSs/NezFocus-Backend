import { DomainError } from '@/shared/domain/domain-error'

/**
 * A second time zone change within 24 hours (REQ-AUTH-08): 429 with
 * `data.reason = "timezone"` and `data.changeable_at`, so the page can say
 * "you can change it again after 23:47 on 19/10".
 */
export class TimezoneChangeTooSoonError extends DomainError {
    readonly kind = 'rate_limited'
    readonly errorKey = 'RATE_LIMIT_EXCEEDED'
    readonly retryAfterSeconds: number
    readonly details: { reason: 'timezone'; changeableAt: string }

    constructor(changeableAt: Date, now: Date) {
        super(`The time zone can change once every 24 hours. It can change again after ${changeableAt.toISOString()}.`)
        this.retryAfterSeconds = Math.max(1, Math.ceil((changeableAt.getTime() - now.getTime()) / 1000))
        this.details = { reason: 'timezone', changeableAt: changeableAt.toISOString() }
    }
}
