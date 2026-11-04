import { CodeEmailWording, CodePurpose } from '@/modules/auth/domain'

/**
 * Auth Mailer Port — the emails signing in sends.
 *
 * Queued, not sent inline: an SMTP server that is slow or down must not show
 * in the response. That matters most for "forgot password", which answers the
 * same whether or not the address has an account — a failed send that became
 * a 500 would say which ones do.
 */
export interface AuthMailerPort {
    sendCode(
        to: string,
        code: string,
        purpose: CodePurpose,
        expiresInMinutes: number,
        wording?: CodeEmailWording
    ): Promise<void>

    /** Tell the owner their password changed — the email they need if it wasn't them. */
    sendPasswordChanged(to: string): Promise<void>

    /**
     * Tell the owner of a confirmed address that someone tried to sign up with
     * it: what they get instead of a code, so sign-up answers the same for
     * every address and the owner is not left waiting for a code that never comes.
     * Says how they sign in: an account made with Google has no password.
     */
    sendAccountExists(to: string, methods: AccountSignInMethods): Promise<void>

    /** A first password was set on an account that had none (one made with Google). */
    sendPasswordAdded(to: string): Promise<void>

    /**
     * Tell the owner a new way to sign in (Google) was added to their account:
     * like a password change, the one email they need if it was not them.
     * @param providerName as people know it: "Google"
     */
    sendSignInMethodAdded(to: string, providerName: string): Promise<void>

    /** Two-step sign-in was turned on or off: the email they need if it was not them. */
    sendTwoFactorChanged(to: string, enabled: boolean): Promise<void>

    /** The account was deleted: the one email they need if it was not them. */
    sendAccountDeleted(to: string): Promise<void>

    /** New recovery codes were made; the earlier ones stopped working. */
    sendRecoveryCodesReplaced(to: string): Promise<void>

    /** A recovery code was used to sign in, and how many are left. */
    sendRecoveryCodeUsed(to: string, remaining: number): Promise<void>
}

/** How an account signs in, for an email to its owner. */
export interface AccountSignInMethods {
    password: boolean
    /** Other providers, as people know them: "Google". */
    providers: string[]
}

export const AUTH_MAILER = Symbol('AuthMailerPort')
