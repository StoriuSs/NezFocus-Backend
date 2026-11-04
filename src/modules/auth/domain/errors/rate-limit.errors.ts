import { DomainError } from '@/shared/domain/domain-error'

/**
 * Why a limit refused, as the auth module's rules name it (rate-limits.ts):
 * - `network`: counted per IP;
 * - `emails`: emails to this address;
 * - `sign_ins`: failed sign-ins for this address;
 * - `wrong_codes`: wrong two-step codes on this account;
 * - `wrong_password`: wrong current passwords on this account.
 */
export type RateLimitReason = 'network' | 'emails' | 'sign_ins' | 'wrong_codes' | 'wrong_password'

const RATE_LIMIT_MESSAGES: Record<RateLimitReason, string> = {
    network: 'Too many requests from your network.',
    emails: 'We have already sent several emails to this address.',
    sign_ins: 'Too many failed sign-ins for this address.',
    wrong_codes: 'Too many wrong codes.',
    wrong_password: 'Too many wrong passwords.'
}

/** `data.reason`: which kind of limit, so a page can say what to do. */
export class RateLimitedError extends DomainError {
    readonly kind = 'rate_limited'
    readonly errorKey = 'RATE_LIMIT_EXCEEDED'
    readonly details?: { reason: RateLimitReason }
    constructor(
        readonly retryAfterSeconds: number,
        reason?: RateLimitReason
    ) {
        super(
            `${reason ? RATE_LIMIT_MESSAGES[reason] : 'Too many attempts.'} Try again in ${formatWait(retryAfterSeconds)}.`
        )
        if (reason) this.details = { reason }
    }
}

function formatWait(seconds: number): string {
    if (seconds < 90) return `${Math.max(1, Math.ceil(seconds))} seconds`
    return `${Math.ceil(seconds / 60)} minutes`
}
