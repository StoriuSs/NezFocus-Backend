import * as path from 'path'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EmailService } from '@/shared/infrastructure/email/email.service'
import { CodePurpose } from '@/modules/auth/domain'

/**
 * A template beside this file. nest-cli.json copies them into dist, so the
 * same path works under ts-jest and in a compiled run.
 */
const template = (name: string) => path.join(__dirname, 'templates', name)

/** The email for each kind of code: its template and its subject. */
const CODE_EMAILS: Record<
    CodePurpose,
    { template: string; subject: (appName: string, firstPassword: boolean) => string }
> = {
    'email-verify': { template: 'verification-code', subject: (app) => `Verify your ${app} account` },
    'password-reset': {
        template: 'password-reset-code',
        subject: (app, firstPassword) =>
            firstPassword ? `Choose a password for your ${app} account` : `Reset your ${app} password`
    },
    'password-set': { template: 'password-set-code', subject: (app) => `Your code to set a ${app} password` },
    'account-delete': {
        template: 'account-delete-code',
        subject: (app) => `Your code to delete your ${app} account`
    }
}

/**
 * Every email auth sends: its subject, its template, and what the template is
 * given. Shared's EmailService only delivers them; a module with emails of its
 * own keeps them beside its code, like these.
 */
@Injectable()
export class AuthEmails {
    constructor(
        private readonly email: EmailService,
        private readonly config: ConfigService
    ) {}

    /**
     * A code: to confirm an address, choose a new password, set a first one,
     * or delete the account.
     *
     * @param expiresInMinutes how long the code works; the email says so
     */
    async sendCode(
        to: string,
        code: string,
        purpose: CodePurpose,
        fullName?: string,
        expiresInMinutes: number = 10,
        { firstPassword = false }: { firstPassword?: boolean } = {}
    ): Promise<void> {
        const appName = this.appName
        const { template: name, subject } = CODE_EMAILS[purpose]
        await this.email.send(to, subject(appName, firstPassword), template(name), {
            code,
            appName,
            expiresIn: expiresInMinutes,
            fullName,
            firstPassword
        })
    }

    /** Tell the owner their password changed, in case it was not them. */
    async sendPasswordChanged(to: string): Promise<void> {
        const appName = this.appName
        await this.email.send(to, `Your ${appName} password was changed`, template('password-changed'), { appName })
    }

    /**
     * Tell the owner of a confirmed address that someone tried to sign up
     * with it. Sent instead of a code, so sign-up can answer the same for
     * every address and the real owner still learns what to do.
     *
     * Says how they sign in: an account made with Google has no password, and
     * "sign in with your password" would send them looking for one.
     *
     * @param methods how the account signs in; absent, the email names none
     */
    async sendAccountExists(to: string, methods?: { password: boolean; providers: string[] }): Promise<void> {
        const appName = this.appName
        const providers = methods?.providers.join(' or ') ?? ''
        await this.email.send(to, `You already have a ${appName} account`, template('account-exists'), {
            appName,
            // One of three: a password (and maybe a provider), a provider only, or not known.
            passwordAndProvider: Boolean(methods?.password && providers),
            providerOnly: Boolean(methods && !methods.password && providers),
            providers,
            signInUrl: `${this.frontendUrl}/sign-in`,
            resetUrl: `${this.frontendUrl}/forgot-password`
        })
    }

    /**
     * A first password was set on an account that had none (one made with
     * Google): the email they need if it was not them.
     */
    async sendPasswordAdded(to: string): Promise<void> {
        const appName = this.appName
        await this.email.send(to, `A password was added to your ${appName} account`, template('password-added'), {
            appName
        })
    }

    /**
     * Tell the owner a new way to sign in (Google) was added to their
     * account: the email they need if it was not them.
     */
    async sendSignInMethodAdded(to: string, providerName: string): Promise<void> {
        const appName = this.appName
        await this.email.send(
            to,
            `${providerName} sign-in was added to your ${appName} account`,
            template('sign-in-method-added'),
            { appName, providerName, resetUrl: `${this.frontendUrl}/forgot-password` }
        )
    }

    /** Two-step sign-in was turned on or off: the email they need if it was not them. */
    async sendTwoFactorChanged(to: string, enabled: boolean): Promise<void> {
        const appName = this.appName
        await this.email.send(
            to,
            `Two-step verification was turned ${enabled ? 'on' : 'off'} for your ${appName} account`,
            template('two-factor-changed'),
            {
                appName,
                enabled,
                resetUrl: `${this.frontendUrl}/forgot-password`,
                supportEmail: this.supportEmail
            }
        )
    }

    /** The account was deleted: when its personal details go, and who to contact if it was not them. */
    async sendAccountDeleted(to: string): Promise<void> {
        const appName = this.appName
        await this.email.send(to, `Your ${appName} account was deleted`, template('account-deleted'), {
            appName,
            retentionDays: this.config.get<number>('app.deletedAccountRetentionDays') ?? 30,
            supportEmail: this.supportEmail
        })
    }

    /** New recovery codes were made; the earlier ones stopped working. */
    async sendRecoveryCodesReplaced(to: string): Promise<void> {
        const appName = this.appName
        await this.email.send(
            to,
            `New recovery codes were made for your ${appName} account`,
            template('recovery-codes-replaced'),
            { appName, resetUrl: `${this.frontendUrl}/forgot-password` }
        )
    }

    /** A recovery code was used to sign in, and how many are left. */
    async sendRecoveryCodeUsed(to: string, remaining: number): Promise<void> {
        const appName = this.appName
        await this.email.send(to, `A recovery code was used to sign in to ${appName}`, template('recovery-code-used'), {
            appName,
            remaining,
            runningLow: remaining <= 3,
            settingsUrl: `${this.frontendUrl}/settings`,
            resetUrl: `${this.frontendUrl}/forgot-password`
        })
    }

    private get appName(): string {
        return this.config.get<string>('app.name')!
    }

    private get frontendUrl(): string {
        return this.config.get<string>('app.frontendUrl')!
    }

    private get supportEmail(): string | null {
        return this.config.get<string | null>('app.supportEmail') ?? null
    }
}
