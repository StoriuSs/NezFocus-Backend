import { DomainError } from '@/shared/domain/domain-error'

/** `/auth/<provider>` for a provider that is not configured here. */
export class OAuthProviderUnknownError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'NOT_FOUND'
    constructor() {
        super('There is no sign-in with that provider here.')
    }
}

/**
 * Why a sign-in with another provider (Google) did not work. What the web
 * app's callback page is told: `?error=<reason>`.
 */
export type OAuthFailure = 'cancelled' | 'failed' | 'email_unverified' | 'account_deleted'

/**
 * A sign-in with another provider that did not work. Not a DomainError: the
 * browser arrived by a redirect from the provider, so it gets a redirect back
 * to the web app, never the JSON error envelope. `detail` is for the log only.
 */
export class OAuthSignInError extends Error {
    /** Where the person was heading, when the attempt got that far: kept for trying again. */
    redirect?: string
    constructor(
        readonly reason: OAuthFailure,
        readonly detail: string
    ) {
        super(`${reason}: ${detail}`)
        this.name = 'OAuthSignInError'
    }
}
