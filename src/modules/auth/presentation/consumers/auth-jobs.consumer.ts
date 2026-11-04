import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnApplicationBootstrap } from '@nestjs/common'
import { Job, Queue } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { AuthEmails } from '@/modules/auth/infrastructure/email/auth-emails'
import {
    AccountExistsJob,
    PasswordAddedJob,
    AUTH_JOBS,
    PasswordChangedJob,
    RecoveryCodeUsedJob,
    RecoveryCodesReplacedJob,
    AccountDeletedJob,
    SendCodeJob,
    SignInMethodAddedJob,
    TwoFactorChangedJob
} from '@/modules/auth/infrastructure/email/auth-email-jobs'

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
                const { to, code, purpose, expiresInMinutes, firstPassword, name } = job.data as SendCodeJob
                await this.emails.sendCode(to, code, purpose, name || undefined, expiresInMinutes, {
                    firstPassword: firstPassword === true
                })
                return
            }
            case AUTH_JOBS.PASSWORD_CHANGED: {
                await this.emails.sendPasswordChanged((job.data as PasswordChangedJob).to)
                return
            }
            case AUTH_JOBS.ACCOUNT_EXISTS: {
                const { to, password, providers } = job.data as AccountExistsJob
                await this.emails.sendAccountExists(
                    to,
                    password === undefined ? undefined : { password, providers: providers ?? [] }
                )
                return
            }
            case AUTH_JOBS.PASSWORD_ADDED: {
                await this.emails.sendPasswordAdded((job.data as PasswordAddedJob).to)
                return
            }
            case AUTH_JOBS.SIGN_IN_METHOD_ADDED: {
                const { to, providerName } = job.data as SignInMethodAddedJob
                await this.emails.sendSignInMethodAdded(to, providerName)
                return
            }
            case AUTH_JOBS.TWO_FACTOR_CHANGED: {
                const { to, enabled } = job.data as TwoFactorChangedJob
                await this.emails.sendTwoFactorChanged(to, enabled)
                return
            }
            case AUTH_JOBS.RECOVERY_CODE_USED: {
                const { to, remaining } = job.data as RecoveryCodeUsedJob
                await this.emails.sendRecoveryCodeUsed(to, remaining)
                return
            }
            case AUTH_JOBS.ACCOUNT_DELETED: {
                await this.emails.sendAccountDeleted((job.data as AccountDeletedJob).to)
                return
            }
            case AUTH_JOBS.RECOVERY_CODES_REPLACED: {
                const { to } = job.data as RecoveryCodesReplacedJob
                await this.emails.sendRecoveryCodesReplaced(to)
                return
            }
            default:
                this.logger.warn(`Unknown auth job "${job.name}" (${job.id}), ignored`)
        }
    }
}
