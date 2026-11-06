import { readFileSync } from 'fs'
import Handlebars from 'handlebars'
import { ConfigService } from '@nestjs/config'
import { EmailService } from '@/shared/infrastructure/email/email.service'
import { EMAIL_LANGUAGES, EmailLanguage } from '@/modules/auth/application/ports'
import { AuthEmails } from './auth-emails'

/**
 * Renders every email the way the mailer does (Handlebars, strict), with what
 * AuthEmails really passes, in each language. A template that is missing, or
 * that uses a name the code does not give it, fails here instead of on the
 * first real send.
 */
describe('AuthEmails', () => {
    interface Sent {
        language: EmailLanguage
        kind: string
        subject: string
        html: string
    }
    const sent: Sent[] = []
    const settings: Record<string, unknown> = {
        'app.name': 'NezFocus',
        'app.frontendUrl': 'https://app.example.test',
        'app.supportEmail': 'help@example.test',
        'app.deletedAccountRetentionDays': 30
    }
    const config = { get: (key: string) => settings[key] }

    async function sendAll(language: EmailLanguage) {
        const to = 'ada@example.test'
        const kinds: [string, (emails: AuthEmails) => Promise<void>][] = [
            ['sign-in', (e) => e.sendCode(to, '123456', 'sign-in', 10, { language, accountExists: true, name: 'Ada' })],
            ['create-account', (e) => e.sendCode(to, '123456', 'sign-in', 10, { language, accountExists: false })],
            ['reset', (e) => e.sendCode(to, '123456', 'password-reset', 10, { language, name: 'Ada' })],
            [
                'first-password',
                (e) => e.sendCode(to, '123456', 'password-reset', 10, { language, firstPassword: true })
            ],
            ['password-changed', (e) => e.sendPasswordChanged(to, language)],
            ['password-added', (e) => e.sendPasswordAdded(to, language)],
            ['sign-in-method-added', (e) => e.sendSignInMethodAdded(to, 'Google', language)],
            ['account-deleted', (e) => e.sendAccountDeleted(to, language)]
        ]
        for (const [kind, send] of kinds) {
            const email = {
                send: async (_to: string, subject: string, template: string, context: Record<string, unknown>) => {
                    const render = Handlebars.compile(readFileSync(`${template}.hbs`, 'utf8'), { strict: true })
                    sent.push({ language, kind, subject, html: render(context) })
                }
            }
            await send(new AuthEmails(email as unknown as EmailService, config as unknown as ConfigService))
        }
    }

    beforeAll(async () => {
        for (const language of EMAIL_LANGUAGES) await sendAll(language)
    })

    const subjectOf = (language: EmailLanguage, kind: string) =>
        sent.find((s) => s.language === language && s.kind === kind)!.subject

    it('renders all eight emails in each language, in strict mode, with what it is given', () => {
        expect(sent).toHaveLength(8 * EMAIL_LANGUAGES.length)
    })

    it('writes each email in the language it is given (D-132)', () => {
        for (const { language, html } of sent) expect(html).toContain(`<html lang='${language}'>`)
        expect(subjectOf('vi', 'sign-in')).toBe('Mã OTP đăng nhập NezFocus')
        expect(subjectOf('en', 'sign-in')).toBe('Your NezFocus sign-in code')
        const kinds = [...new Set(sent.map((s) => s.kind))]
        for (const kind of kinds) expect(subjectOf('vi', kind)).not.toBe(subjectOf('en', kind))
    })

    it('puts the code in every code email, and none in the others', () => {
        const withCode = ['sign-in', 'create-account', 'reset', 'first-password']
        for (const { kind, html } of sent) expect(html.includes('123456')).toBe(withCode.includes(kind))
    })

    it('tells an address with an account it is signing in, and one without that it is making one', () => {
        expect(subjectOf('vi', 'create-account')).toBe('Mã OTP tạo tài khoản NezFocus')
        expect(subjectOf('en', 'create-account')).toBe('Your code to create a NezFocus account')
    })

    it('words a reset for an account with no password as choosing one', () => {
        expect(subjectOf('en', 'reset')).toBe('Reset your NezFocus password')
        expect(subjectOf('en', 'first-password')).toBe('Choose a password for your NezFocus account')
    })

    it('escapes what it is given, so a display name cannot add markup', async () => {
        const email = {
            send: async (_to: string, _subject: string, template: string, context: Record<string, unknown>) => {
                const render = Handlebars.compile(readFileSync(`${template}.hbs`, 'utf8'), { strict: true })
                expect(render(context)).not.toContain('<b>Ada</b>')
            }
        }
        const emails = new AuthEmails(email as unknown as EmailService, config as unknown as ConfigService)
        await emails.sendCode('ada@example.test', '123456', 'sign-in', 10, {
            language: 'en',
            accountExists: true,
            name: '<b>Ada</b>'
        })
        expect.assertions(1)
    })
})
