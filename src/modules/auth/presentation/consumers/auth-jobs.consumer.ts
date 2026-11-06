import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnApplicationBootstrap } from '@nestjs/common'
import { Job, Queue } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { AuthEmails } from '@/modules/auth/infrastructure/email/auth-emails'
import {
    PasswordAddedJob,
    AUTH_JOBS,
    PasswordChangedJob,
    AccountDeletedJob,
    SendCodeJob,
    SignInMethodAddedJob
} from '@/modules/auth/infrastructure/email/auth-email-jobs'
import { DEFAULT_EMAIL_LANGUAGE, EmailLanguage } from '@/modules/auth/application/ports'

/** A job queued before emails had a language is in English. */
const languageOf = (job: Job): EmailLanguage =>
    (job.data as { language?: EmailLanguage }).language ?? DEFAULT_EMAIL_LANGUAGE

/**
 * Where the hourly clean-up was scheduled before it moved to the maintenance
 * queue (src/maintenance). The schedule lives in Redis, so an existing
 * deployment still has it; removing a scheduler that is not there does nothing.
 */
const RETIRED_CLEAN_UP_SCHEDULER_ID = 'auth-clean-up'

/**
 * Auth Jobs Consumer — Inbound Adapter
 *
 * Sends the emails that signing in queues. Only emails: auth's clean-up runs on
 * the maintenance queue, so a backlog of emails never delays it.
 */
@Processor(QUEUES.AUTH)
export class AuthJobsConsumer extends WorkerHost implements OnApplicationBootstrap {
    private readonly logger = new Logger(AuthJobsConsumer.name)

    constructor(
        private readonly emails: AuthEmails,
        @InjectQueue(QUEUES.AUTH) private readonly queue: Queue
    ) {
        super()
    }

    async onApplicationBootstrap(): Promise<void> {
        await this.queue.removeJobScheduler(RETIRED_CLEAN_UP_SCHEDULER_ID)
    }

    async process(job: Job): Promise<void> {
        switch (job.name) {
            case AUTH_JOBS.SEND_CODE: {
                const { to, code, purpose, expiresInMinutes, accountExists, firstPassword, name } =
                    job.data as SendCodeJob
                // A code of a flow that no longer exists (queued before an
                // upgrade): it could not be used anyway.
                if (purpose !== 'sign-in' && purpose !== 'password-reset') {
                    this.logger.warn(`Code email for the retired purpose "${String(purpose)}" (${job.id}), dropped`)
                    return
                }
                await this.emails.sendCode(to, code, purpose, expiresInMinutes, {
                    language: languageOf(job),
                    accountExists: accountExists === true,
                    firstPassword: firstPassword === true,
                    name: name || undefined
                })
                return
            }
            case AUTH_JOBS.PASSWORD_CHANGED: {
                await this.emails.sendPasswordChanged((job.data as PasswordChangedJob).to, languageOf(job))
                return
            }
            case AUTH_JOBS.PASSWORD_ADDED: {
                await this.emails.sendPasswordAdded((job.data as PasswordAddedJob).to, languageOf(job))
                return
            }
            case AUTH_JOBS.SIGN_IN_METHOD_ADDED: {
                const { to, providerName } = job.data as SignInMethodAddedJob
                await this.emails.sendSignInMethodAdded(to, providerName, languageOf(job))
                return
            }
            case AUTH_JOBS.ACCOUNT_DELETED: {
                await this.emails.sendAccountDeleted((job.data as AccountDeletedJob).to, languageOf(job))
                return
            }
            default:
                this.logger.warn(`Unknown auth job "${job.name}" (${job.id}), ignored`)
        }
    }
}
