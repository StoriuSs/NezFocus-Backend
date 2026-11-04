import { Logger } from '@nestjs/common'
import { CaptchaPort } from '@/modules/auth/application/ports'

export interface TurnstileSettings {
    /** Both empty: the check is off. */
    siteKey: string
    secretKey: string
    /** Cloudflare's; a test points it at a stand-in. */
    verifyUrl?: string
    timeoutMs?: number
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Answers Cloudflare gives when the request, not the visitor, is at fault. */
const OUR_FAULT = new Set(['missing-input-secret', 'invalid-input-secret', 'bad-request', 'internal-error'])

/**
 * Cloudflare Turnstile: checks the token the widget gave the page with
 * Cloudflare's siteverify. Off (siteKey null) when no keys are configured.
 *
 * Cloudflare unreachable, slow (5 s) or refusing our secret is `unavailable`,
 * and the caller refuses the request: an outage that stops sign-ups is an
 * ordinary outage; one that silently turns the check off is not.
 */
export class TurnstileCaptcha implements CaptchaPort {
    private readonly logger = new Logger(TurnstileCaptcha.name)
    readonly siteKey: string | null

    constructor(private readonly settings: TurnstileSettings) {
        this.siteKey = settings.siteKey && settings.secretKey ? settings.siteKey : null
    }

    async verify(token: string, ip: string): Promise<'passed' | 'failed' | 'unavailable'> {
        if (!this.siteKey) return 'passed'
        if (!token || token.length > 2048) return 'failed'

        let answer: { success?: boolean; 'error-codes'?: string[] }
        try {
            const response = await fetch(this.settings.verifyUrl ?? SITEVERIFY, {
                method: 'POST',
                body: new URLSearchParams({ secret: this.settings.secretKey, response: token, remoteip: ip }),
                signal: AbortSignal.timeout(this.settings.timeoutMs ?? 5000)
            })
            answer = (await response.json()) as typeof answer
        } catch (error) {
            this.logger.error(`Turnstile could not be asked: ${(error as Error).message}`)
            return 'unavailable'
        }

        if (answer.success === true) return 'passed'
        const codes = answer['error-codes'] ?? []
        if (codes.some((code) => OUR_FAULT.has(code))) {
            this.logger.error(`Turnstile refused the check itself (${codes.join(', ')}): check TURNSTILE_SECRET_KEY`)
            return 'unavailable'
        }
        return 'failed'
    }
}
