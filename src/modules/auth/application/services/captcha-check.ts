import { Inject, Injectable } from '@nestjs/common'
import { CaptchaFailedError, CaptchaRequiredError, CaptchaUnavailableError } from '@/modules/auth/domain'
import { CAPTCHA, CaptchaPort } from '../ports'

/**
 * Turnstile, for the commands: on when both keys are set, and then the forms
 * that need it refuse a request without a solved challenge.
 */
@Injectable()
export class CaptchaCheck {
    constructor(@Inject(CAPTCHA) private readonly captcha: CaptchaPort) {}

    get enabled(): boolean {
        return this.captcha.siteKey !== null
    }

    /** Refuse unless the token checks out. Nothing to do when Turnstile is off. */
    async require(token: string | undefined, ip: string): Promise<void> {
        if (!this.enabled) return
        if (!token) throw new CaptchaRequiredError()
        const result = await this.captcha.verify(token, ip)
        if (result === 'unavailable') throw new CaptchaUnavailableError()
        if (result === 'failed') throw new CaptchaFailedError()
    }
}
