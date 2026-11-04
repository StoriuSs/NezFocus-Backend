import { access } from 'fs/promises'
import * as path from 'path'
import { Injectable } from '@nestjs/common'
import { MailerService } from '@nestjs-modules/mailer'
import { EmailContext } from './interfaces'

/**
 * Delivers an email from a module's template. It knows nothing of what any
 * email says: a module keeps its templates and their wording beside the code
 * that sends them (auth's are in src/modules/auth/infrastructure/email/), so a
 * new module's emails never mean editing shared code.
 */
@Injectable()
export class EmailService {
    constructor(private readonly mailerService: MailerService) {}

    /**
     * @param template the template's absolute path, without `.hbs`
     * @param context what the template is given; with `strict`, a name it uses
     *   and is not given is an error, not an empty string
     */
    async send(to: string, subject: string, template: string, context: EmailContext): Promise<void> {
        await this.assertTemplateExists(template)
        await this.mailerService.sendMail({ to, subject, template, context })
    }

    /**
     * The mailer's Handlebars adapter answers a missing template by throwing
     * outside the send's promise, which ends the whole process rather than
     * failing this one email. Checked here, it is an ordinary error: the
     * email's job fails, is retried and reported, and the app keeps serving.
     */
    private async assertTemplateExists(template: string): Promise<void> {
        const file = path.extname(template) ? template : `${template}.hbs`
        try {
            await access(file)
        } catch {
            throw new Error(`Email template not found: ${file}`)
        }
    }
}
