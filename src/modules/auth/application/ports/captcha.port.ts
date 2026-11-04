/**
 * Captcha Port — "is this a person?" (Cloudflare Turnstile): a token the page
 * got from the widget, checked with the provider.
 */
export interface CaptchaPort {
    /**
     * The public key the web app's widget needs; null when the check is off
     * (no keys configured), and then every form works without it.
     */
    readonly siteKey: string | null

    /**
     * @returns `unavailable` when the provider could not be asked: the caller
     *   refuses the request rather than letting it through unchecked
     */
    verify(token: string, ip: string): Promise<'passed' | 'failed' | 'unavailable'>
}

export const CAPTCHA = Symbol('CaptchaPort')
