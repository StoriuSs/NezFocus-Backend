import { CodePurpose } from '@/modules/auth/domain'

/** The languages an email is written in (NFR-I18N-01). */
export const EMAIL_LANGUAGES = ['vi', 'en'] as const
export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number]

/**
 * For a request that does not say, and for an email nobody asked for sent to
 * an account not completed yet (no language chosen): English, as for any
 * browser not set to Vietnamese (D-64).
 */
export const DEFAULT_EMAIL_LANGUAGE: EmailLanguage = 'en'

/** An account's chosen language as the language of its emails (D-132). */
export function accountEmailLanguage(language: string | null): EmailLanguage {
    return EMAIL_LANGUAGES.find((known) => known === language) ?? DEFAULT_EMAIL_LANGUAGE
}

/** How a code email is worded, beyond its purpose. */
export interface CodeEmail {
    /** The language of the page the code was asked for from (D-132). */
    language: EmailLanguage
    /** A sign-in code: the address has an account (sign in) or not (make one). */
    accountExists?: boolean
    /** A reset code for an account with no password yet: "choose a password", not "reset". */
    firstPassword?: boolean
    /** The account's display name, for "Hello, <name>." Absent: "Hello." */
    name?: string
}

/**
 * Auth Mailer Port — the emails signing in sends.
 *
 * Queued, not sent inline: an SMTP server that is slow or down must not show
 * in the response. That matters most for the routes that answer the same
 * whether or not the address has an account — a failed send that became a
 * 500 would say which ones do.
 *
 * Each email is in the language given: the page's for an email the person
 * just asked for, the account's for one they did not (D-132).
 */
export interface AuthMailerPort {
    sendCode(to: string, code: string, purpose: CodePurpose, expiresInMinutes: number, email: CodeEmail): Promise<void>

    /** Tell the owner their password changed — the email they need if it wasn't them. */
    sendPasswordChanged(to: string, language: EmailLanguage): Promise<void>

    /** A first password was set on an account that had none. */
    sendPasswordAdded(to: string, language: EmailLanguage): Promise<void>

    /**
     * Tell the owner a new way to sign in (Google) was added to their account:
     * like a password change, the one email they need if it was not them.
     * @param providerName as people know it: "Google"
     */
    sendSignInMethodAdded(to: string, providerName: string, language: EmailLanguage): Promise<void>

    /** The account was deleted: the one email they need if it was not them. */
    sendAccountDeleted(to: string, language: EmailLanguage): Promise<void>
}

export const AUTH_MAILER = Symbol('AuthMailerPort')
