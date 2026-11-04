import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { MailerService } from '@nestjs-modules/mailer'
import { EmailService } from './email.service'

describe('EmailService', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'email-templates-'))
    writeFileSync(path.join(dir, 'welcome.hbs'), '<p>Hello</p>')

    const setup = () => {
        const mailer = { sendMail: jest.fn().mockResolvedValue(undefined) }
        return { mailer, email: new EmailService(mailer as unknown as MailerService) }
    }

    it('sends a template that exists', async () => {
        const { mailer, email } = setup()

        await email.send('ada@example.test', 'Welcome', path.join(dir, 'welcome'), { appName: 'App' })

        expect(mailer.sendMail).toHaveBeenCalledWith({
            to: 'ada@example.test',
            subject: 'Welcome',
            template: path.join(dir, 'welcome'),
            context: { appName: 'App' }
        })
    })

    // The mailer itself would throw outside the promise and end the process.
    it('fails the send, and only the send, when the template is missing', async () => {
        const { mailer, email } = setup()

        await expect(email.send('ada@example.test', 'Welcome', path.join(dir, 'missing'), {})).rejects.toThrow(
            /Email template not found: .*missing\.hbs/
        )
        expect(mailer.sendMail).not.toHaveBeenCalled()
    })
})
