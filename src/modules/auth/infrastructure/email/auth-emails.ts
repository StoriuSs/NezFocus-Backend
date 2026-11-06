import * as path from 'path'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EmailService } from '@/shared/infrastructure/email/email.service'
import { CodePurpose } from '@/modules/auth/domain'
import type { CodeEmail, EmailLanguage } from '@/modules/auth/application/ports'
import { EMAIL_COPY, EmailContent } from './email-copy'

/**
 * The one layout beside this file. nest-cli.json copies templates into dist,
 * so the same path works under ts-jest and in a compiled run.
 */
const LAYOUT = path.join(__dirname, 'templates', 'email')

/**
 * Every email auth sends: its words (email-copy.ts, in the language asked
 * for) in the shared layout. Shared's EmailService only delivers them; a
 * module with emails of its own keeps them beside its code, like these.
 */
@Injectable()
export class AuthEmails {
    constructor(
        private readonly email: EmailService,
        private readonly config: ConfigService
    ) {}

    /**
     * A code: to sign in (or create the account, when the address has none),
     * or to choose a new password.
     *
     * @param expiresInMinutes how long the code works; the email says so
     */
    async sendCode(
        to: string,
        code: string,
        purpose: CodePurpose,
        expiresInMinutes: number,
        { language, accountExists = false, firstPassword = false, name }: CodeEmail
    ): Promise<void> {
        const copy = EMAIL_COPY[language]
        const vars = { app: this.appName, code, minutes: expiresInMinutes, name }
        const content =
            purpose === 'sign-in'
                ? accountExists
                    ? copy.signInCode(vars)
                    : copy.createAccountCode(vars)
                : firstPassword
                  ? copy.firstPasswordCode(vars)
                  : copy.resetCode(vars)
        await this.send(to, language, content)
    }

    /** Tell the owner their password changed, in case it was not them. */
    async sendPasswordChanged(to: string, language: EmailLanguage): Promise<void> {
        await this.send(to, language, EMAIL_COPY[language].passwordChanged(this.links))
    }

    /** A first password was set on an account that had none: the email they need if it was not them. */
    async sendPasswordAdded(to: string, language: EmailLanguage): Promise<void> {
        await this.send(to, language, EMAIL_COPY[language].passwordAdded(this.links))
    }

    /** A new way to sign in (Google) was added: the email they need if it was not them. */
    async sendSignInMethodAdded(to: string, providerName: string, language: EmailLanguage): Promise<void> {
        await this.send(to, language, EMAIL_COPY[language].signInMethodAdded({ ...this.links, provider: providerName }))
    }

    /** The account was deleted: when its personal details go, and who to contact if it was not them. */
    async sendAccountDeleted(to: string, language: EmailLanguage): Promise<void> {
        const content = EMAIL_COPY[language].accountDeleted({
            app: this.appName,
            days: this.config.get<number>('app.deletedAccountRetentionDays') ?? 30,
            support: this.config.get<string | null>('app.supportEmail') || null
        })
        await this.send(to, language, content)
    }

    private async send(to: string, language: EmailLanguage, content: EmailContent): Promise<void> {
        await this.email.send(to, content.subject, LAYOUT, { lang: language, appName: this.appName, ...content })
    }

    private get links() {
        return { app: this.appName, resetUrl: `${this.config.get<string>('app.frontendUrl')!}/forgot-password` }
    }

    private get appName(): string {
        return this.config.get<string>('app.name')!
    }
}
