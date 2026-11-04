import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { AccountSignInMethods, AuthMailerPort } from '@/modules/auth/application/ports'
import { CodeEmailWording, CodePurpose } from '@/modules/auth/domain'
import {
    AUTH_JOBS,
    SendCodeJob,
    PasswordChangedJob,
    AccountExistsJob,
    PasswordAddedJob,
    SignInMethodAddedJob,
    TwoFactorChangedJob,
    AccountDeletedJob,
    RecoveryCodesReplacedJob,
    RecoveryCodeUsedJob,
    EMAIL_JOB_OPTIONS
} from '../email/auth-email-jobs'

/** Queues the emails; AuthJobsConsumer sends them. */
@Injectable()
export class BullMqAuthMailer implements AuthMailerPort {
    constructor(@InjectQueue(QUEUES.AUTH) private readonly queue: Queue) {}

    async sendCode(
        to: string,
        code: string,
        purpose: CodePurpose,
        expiresInMinutes: number,
        wording: CodeEmailWording = {}
    ): Promise<void> {
        const job: SendCodeJob = {
            to,
            code,
            purpose,
            expiresInMinutes,
            firstPassword: wording.firstPassword,
            name: wording.name
        }
        await this.queue.add(AUTH_JOBS.SEND_CODE, job, EMAIL_JOB_OPTIONS)
    }

    async sendPasswordChanged(to: string): Promise<void> {
        const job: PasswordChangedJob = { to }
        await this.queue.add(AUTH_JOBS.PASSWORD_CHANGED, job, EMAIL_JOB_OPTIONS)
    }

    async sendAccountExists(to: string, methods: AccountSignInMethods): Promise<void> {
        const job: AccountExistsJob = { to, password: methods.password, providers: methods.providers }
        await this.queue.add(AUTH_JOBS.ACCOUNT_EXISTS, job, EMAIL_JOB_OPTIONS)
    }

    async sendPasswordAdded(to: string): Promise<void> {
        const job: PasswordAddedJob = { to }
        await this.queue.add(AUTH_JOBS.PASSWORD_ADDED, job, EMAIL_JOB_OPTIONS)
    }

    async sendSignInMethodAdded(to: string, providerName: string): Promise<void> {
        const job: SignInMethodAddedJob = { to, providerName }
        await this.queue.add(AUTH_JOBS.SIGN_IN_METHOD_ADDED, job, EMAIL_JOB_OPTIONS)
    }

    async sendTwoFactorChanged(to: string, enabled: boolean): Promise<void> {
        const job: TwoFactorChangedJob = { to, enabled }
        await this.queue.add(AUTH_JOBS.TWO_FACTOR_CHANGED, job, EMAIL_JOB_OPTIONS)
    }

    async sendAccountDeleted(to: string): Promise<void> {
        const job: AccountDeletedJob = { to }
        await this.queue.add(AUTH_JOBS.ACCOUNT_DELETED, job, EMAIL_JOB_OPTIONS)
    }

    async sendRecoveryCodesReplaced(to: string): Promise<void> {
        const job: RecoveryCodesReplacedJob = { to }
        await this.queue.add(AUTH_JOBS.RECOVERY_CODES_REPLACED, job, EMAIL_JOB_OPTIONS)
    }

    async sendRecoveryCodeUsed(to: string, remaining: number): Promise<void> {
        const job: RecoveryCodeUsedJob = { to, remaining }
        await this.queue.add(AUTH_JOBS.RECOVERY_CODE_USED, job, EMAIL_JOB_OPTIONS)
    }
}
