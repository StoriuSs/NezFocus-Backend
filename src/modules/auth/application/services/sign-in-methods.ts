import { Inject, Injectable } from '@nestjs/common'
import { OAUTH_PROVIDERS, OAuthProviderPort } from '../ports'
import {
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    OAUTH_ACCOUNT_REPOSITORY,
    OAuthAccountRepositoryPort
} from '@/modules/auth/domain'

/** How an account can sign in. */
export interface SignInMethodsOf {
    /** It has a password: email-and-password sign-in works. */
    password: boolean
    /** Other providers linked to it, by id (`google`), in a stable order. */
    providers: string[]
}

/**
 * How an account signs in: with a password, with Google, or both. An account
 * made with Google has no password until its owner sets one (settings, or
 * "forgot password"); one made with a password has no provider until its
 * owner continues with Google.
 */
@Injectable()
export class SignInMethods {
    constructor(
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly oauthAccounts: OAuthAccountRepositoryPort,
        @Inject(OAUTH_PROVIDERS) private readonly providers: OAuthProviderPort[]
    ) {}

    async of(userId: string): Promise<SignInMethodsOf> {
        const [hash, providers] = await Promise.all([
            this.credentials.findHash(userId),
            this.oauthAccounts.providersOf(userId)
        ])
        return { password: hash !== null, providers }
    }

    /**
     * The name people know a provider by, for emails: `Google`. One no longer
     * configured (its keys removed since the account linked it) keeps a
     * readable name.
     */
    displayName(id: string): string {
        return this.providers.find((provider) => provider.id === id)?.displayName ?? id[0].toUpperCase() + id.slice(1)
    }
}
