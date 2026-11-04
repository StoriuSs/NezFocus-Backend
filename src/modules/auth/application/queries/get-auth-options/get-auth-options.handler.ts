import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { GetAuthOptionsQuery } from './get-auth-options.query'
import { CAPTCHA, CaptchaPort, OAUTH_PROVIDERS, OAuthProviderPort } from '../../ports'

export interface AuthOptions {
    /** The other sign-in providers configured, by id (`google`). */
    providers: string[]
    /** Turnstile's site key, or null when it is off. */
    turnstileSiteKey: string | null
}

/** What the sign-in pages need to know before anyone signs in. */
@QueryHandler(GetAuthOptionsQuery)
export class GetAuthOptionsHandler implements IQueryHandler<GetAuthOptionsQuery> {
    constructor(
        @Inject(OAUTH_PROVIDERS) private readonly providers: OAuthProviderPort[],
        @Inject(CAPTCHA) private readonly captcha: CaptchaPort
    ) {}

    async execute(): Promise<AuthOptions> {
        return { providers: this.providers.map((provider) => provider.id), turnstileSiteKey: this.captcha.siteKey }
    }
}
