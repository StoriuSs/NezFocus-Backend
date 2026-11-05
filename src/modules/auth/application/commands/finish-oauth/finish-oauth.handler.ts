import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { FinishOAuthCommand } from './finish-oauth.command'
import { DirectoryUser, normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort,
    OAUTH_ACCOUNT_REPOSITORY,
    OAuthAccountRepositoryPort,
    OAuthProviderUnknownError,
    OAuthSignInError
} from '@/modules/auth/domain'
import {
    AUTH_EVENTS,
    AUTH_MAILER,
    AuthEventsPort,
    AuthMailerPort,
    OAUTH_PROVIDERS,
    OAUTH_STATE,
    OAuthChecks,
    OAuthIdentity,
    OAuthProviderPort,
    OAuthStatePort,
    SESSION_CACHE,
    SessionCachePort
} from '../../ports'
import { OAUTH_SETTINGS, OAuthSettings, oauthRedirectUri } from '../../oauth-settings'
import { IssuedSession } from '../../services/session-issuer'
import { SignInGate } from '../../services/sign-in-gate'

/** The account a provider sign-in lands in, and whether linking removed a password. */
interface Linked {
    user: DirectoryUser
    passwordRemoved: boolean
}

/** A session, and the web app page to return to afterwards. */
export interface OAuthFinished {
    session: IssuedSession
    /** A path, checked when the attempt began. */
    redirect: string
    /**
     * Something the person should be told: `password_removed` — the account
     * had been signed up with a password but never confirmed, so that
     * password (perhaps someone else's) was removed on linking.
     */
    notice?: 'password_removed'
}

/**
 * The return from another provider (Google): check it belongs to an attempt
 * this browser began, redeem the code, decide which account it is, sign in.
 *
 * Which account:
 * 1. The one already linked to the provider's person, if any. A deleted one
 *    is refused.
 * 2. Otherwise, by address — only one the provider says it verified:
 *    - no account: a new one, confirmed, with no password;
 *    - a confirmed account: linked, and its owner emailed that a way to sign
 *      in was added (the email they need if it was not them);
 *    - an account never confirmed: its password is deleted before linking.
 *      Whoever set it never proved they read the inbox; the provider just
 *      did. Otherwise someone could register a victim's address first, wait
 *      for them to sign in with Google, then sign in with the password.
 *
 * Every failure is an OAuthSignInError, which the controller turns into a
 * redirect to the web app naming the reason.
 */
@CommandHandler(FinishOAuthCommand)
export class FinishOAuthHandler implements ICommandHandler<FinishOAuthCommand> {
    constructor(
        @Inject(OAUTH_PROVIDERS) private readonly providers: OAuthProviderPort[],
        @Inject(OAUTH_STATE) private readonly attempts: OAuthStatePort,
        @Inject(OAUTH_SETTINGS) private readonly settings: OAuthSettings,
        @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly links: OAuthAccountRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly gate: SignInGate
    ) {}

    async execute(command: FinishOAuthCommand): Promise<OAuthFinished> {
        const provider = this.providers.find((p) => p.id === command.provider)
        if (!provider) throw new OAuthProviderUnknownError()
        try {
            const finished = await this.finish(provider, command)
            this.events.record('oauth_login_succeeded')
            return finished
        } catch (error) {
            if (error instanceof OAuthSignInError) this.events.record('oauth_login_failed')
            throw error
        }
    }

    private async finish(provider: OAuthProviderPort, command: FinishOAuthCommand): Promise<OAuthFinished> {
        const params = new URLSearchParams(command.query)
        const state = params.get('state')
        // The cookie ties the return to the browser that left. Without the
        // check, someone could send a victim a return link carrying their own
        // code, and the victim would be signed in to the attacker's account.
        if (!state || !command.cookieState || state !== command.cookieState) {
            throw new OAuthSignInError('failed', 'the state does not match this browser')
        }
        const attempt = await this.attempts.take(state)
        if (!attempt || attempt.provider !== provider.id) {
            throw new OAuthSignInError('failed', 'no attempt with this state (used, expired, or never begun)')
        }
        try {
            return await this.complete(provider, params, attempt.redirect, attempt.checks, command)
        } catch (error) {
            // Where the person was heading: the web app keeps it for trying again.
            if (error instanceof OAuthSignInError) error.redirect = attempt.redirect
            throw error
        }
    }

    private async complete(
        provider: OAuthProviderPort,
        params: URLSearchParams,
        redirect: string,
        checks: OAuthChecks,
        command: FinishOAuthCommand
    ): Promise<OAuthFinished> {
        const providerError = params.get('error')
        if (providerError) {
            // access_denied: the person chose not to. Anything else is the
            // provider refusing the request, which is ours to fix.
            throw new OAuthSignInError(
                providerError === 'access_denied' ? 'cancelled' : 'failed',
                `the provider answered ${providerError.slice(0, 100)}`
            )
        }

        const redirectUri = oauthRedirectUri(this.settings, provider.id)
        // Built from the registered address, not the request: behind a proxy
        // the request's own URL is an internal one the provider never saw.
        const callbackUrl = new URL(redirectUri)
        callbackUrl.search = params.toString()
        let identity: OAuthIdentity
        try {
            identity = await provider.finish(callbackUrl, redirectUri, checks)
        } catch (error) {
            throw new OAuthSignInError('failed', `the code could not be redeemed: ${(error as Error).message}`)
        }

        const { user, passwordRemoved } = await this.accountFor(provider, identity)
        const session = await this.gate.pass(user.id, command.client, new Date())
        return {
            session,
            redirect,
            ...(passwordRemoved ? { notice: 'password_removed' as const } : {})
        }
    }

    private async accountFor(provider: OAuthProviderPort, identity: OAuthIdentity): Promise<Linked> {
        const linked = await this.linkedUser(provider.id, identity.subject)
        if (linked) return { user: linked, passwordRemoved: false }

        if (!identity.email || !identity.emailVerified) {
            throw new OAuthSignInError('email_unverified', 'the provider has not verified the address')
        }
        const email = normaliseEmail(identity.email)

        const existing = await this.directory.findByEmail(email)
        const user = existing ?? (await this.directory.createVerified(email, identity.name))
        if (!user) {
            // A concurrent sign-up took the address between the two calls.
            // The person is the same: carry on with that account.
            const winner = await this.directory.findByEmail(email)
            if (!winner) throw new OAuthSignInError('failed', 'the account could not be created')
            return this.link(provider, identity, winner, { wasConfirmed: winner.emailVerified, isNew: false })
        }
        return this.link(provider, identity, user, {
            wasConfirmed: existing?.emailVerified ?? true,
            isNew: !existing
        })
    }

    private async link(
        provider: OAuthProviderPort,
        identity: OAuthIdentity,
        user: DirectoryUser,
        { wasConfirmed, isNew }: { wasConfirmed: boolean; isNew: boolean }
    ): Promise<Linked> {
        let passwordRemoved = false
        if (!wasConfirmed) {
            passwordRemoved = (await this.credentials.findHash(user.id)) !== null
            await this.credentials.delete(user.id)
            await this.directory.markEmailVerified(user.id)
            await this.cache.invalidateUser(user.id)
        }

        if (!(await this.links.link(user.id, provider.id, identity.subject))) {
            // Two returns for the same person at once, and the other linked
            // first — perhaps to another account. Sign in to whichever it is.
            const winner = await this.linkedUser(provider.id, identity.subject)
            if (!winner) throw new OAuthSignInError('failed', 'the account could not be linked')
            return { user: winner, passwordRemoved: false }
        }

        if (!isNew) {
            this.events.record('oauth_account_linked')
            if (wasConfirmed && user.email) await this.mailer.sendSignInMethodAdded(user.email, provider.displayName)
        }
        return { user, passwordRemoved }
    }

    private async linkedUser(provider: string, subject: string): Promise<DirectoryUser | null> {
        const userId = await this.links.findUserId(provider, subject)
        if (!userId) return null
        const user = await this.directory.findById(userId)
        if (!user || user.deletedAt) throw new OAuthSignInError('account_deleted', 'the linked account is deleted')
        return user
    }
}
