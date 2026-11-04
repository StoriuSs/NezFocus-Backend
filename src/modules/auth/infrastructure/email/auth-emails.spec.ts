import { readFileSync } from 'fs'
import Handlebars from 'handlebars'
import { ConfigService } from '@nestjs/config'
import { EmailService } from '@/shared/infrastructure/email/email.service'
import { AuthEmails } from './auth-emails'

/**
 * Renders every email the way the mailer does (Handlebars, strict), with what
 * AuthEmails really passes. A template that is missing, or that uses a name
 * the code does not give it, fails here instead of on the first real send.
 */
describe('AuthEmails', () => {
    const sent: { subject: string; template: string; context: Record<string, unknown> }[] = []
    const email = {
        send: async (_to: string, subject: string, template: string, context: Record<string, unknown>) => {
            sent.push({ subject, template, context })
        }
    }
    const settings: Record<string, unknown> = {
        'app.name': 'Acme',
        'app.frontendUrl': 'https://app.example.test',
        'app.supportEmail': 'help@example.test',
        'app.deletedAccountRetentionDays': 30
    }
    const config = { get: (key: string) => settings[key] }
    const emails = new AuthEmails(email as unknown as EmailService, config as unknown as ConfigService)

    beforeAll(async () => {
        const to = 'ada@example.test'
        for (const purpose of ['email-verify', 'password-reset', 'password-set', 'account-delete'] as const) {
            await emails.sendCode(to, '123456', purpose, 'Ada', 10)
        }
        await emails.sendCode(to, '123456', 'password-reset', undefined, 10, { firstPassword: true })
        await emails.sendPasswordChanged(to)
        await emails.sendAccountExists(to, { password: true, providers: ['Google'] })
        await emails.sendAccountExists(to, { password: false, providers: ['Google'] })
        await emails.sendAccountExists(to)
        await emails.sendPasswordAdded(to)
        await emails.sendSignInMethodAdded(to, 'Google')
        await emails.sendTwoFactorChanged(to, true)
        await emails.sendTwoFactorChanged(to, false)
        await emails.sendAccountDeleted(to)
        await emails.sendRecoveryCodesReplaced(to)
        await emails.sendRecoveryCodeUsed(to, 2)
    })

    it('has a template for all twelve emails', () => {
        expect(new Set(sent.map(({ template }) => template)).size).toBe(12)
    })

    it('renders every one of them, in strict mode, with what it is given', () => {
        for (const { template, context } of sent) {
            const render = Handlebars.compile(readFileSync(`${template}.hbs`, 'utf8'), { strict: true })
            expect(() => render(context)).not.toThrow()
        }
    })

    it('words a reset for an account with no password as choosing one', () => {
        const subjects = sent.filter(({ template }) => template.endsWith('password-reset-code')).map((s) => s.subject)
        expect(subjects).toEqual(['Reset your Acme password', 'Choose a password for your Acme account'])
    })
})
