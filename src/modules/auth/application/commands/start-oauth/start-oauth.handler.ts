import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { StartOAuthCommand } from './start-oauth.command'
import { OAuthProviderUnknownError } from '@/modules/auth/domain'
import { OAUTH_PROVIDERS, OAUTH_STATE, OAuthProviderPort, OAuthStatePort } from '../../ports'
import { OAUTH_SETTINGS, OAuthSettings, oauthRedirectUri } from '../../oauth-settings'

export interface OAuthStarted {
    /** Where to send the browser. */
    authorizationUrl: string
    /** Also goes into a cookie, so the return can be tied to this browser. */
    state: string
}

/**
 * Begin a sign-in with another provider: make the checks the return must
 * match, keep them on the server, and say where to send the browser.
 */
@CommandHandler(StartOAuthCommand)
export class StartOAuthHandler implements ICommandHandler<StartOAuthCommand> {
    constructor(
        @Inject(OAUTH_PROVIDERS) private readonly providers: OAuthProviderPort[],
        @Inject(OAUTH_STATE) private readonly attempts: OAuthStatePort,
        @Inject(OAUTH_SETTINGS) private readonly settings: OAuthSettings
    ) {}

    async execute(command: StartOAuthCommand): Promise<OAuthStarted> {
        const provider = this.providers.find((p) => p.id === command.provider)
        if (!provider) throw new OAuthProviderUnknownError()

        const { authorizationUrl, checks } = await provider.start(oauthRedirectUri(this.settings, provider.id))
        await this.attempts.save(
            { provider: provider.id, checks, redirect: safeReturnPath(command.redirect) },
            this.settings.attemptTtlSeconds
        )
        return { authorizationUrl, state: checks.state }
    }
}

/**
 * A path on the web app, or `/`. Never another site: the return goes to
 * FRONTEND_URL + this, so `//evil.example` or `/\evil.example` (which
 * browsers read as another host) must not get through. The web app checks it
 * again before following it.
 */
export function safeReturnPath(redirect: string | undefined): string {
    if (!redirect || redirect.length > 2048) return '/'
    if (!redirect.startsWith('/') || redirect.startsWith('//') || redirect.includes('\\')) return '/'
    // Control characters (a newline in a Location header) have no business here.
    if ([...redirect].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return '/'
    return redirect
}
