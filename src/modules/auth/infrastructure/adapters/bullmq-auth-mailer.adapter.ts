import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { AuthMailerPort, CodeEmail, EmailLanguage } from '@/modules/auth/application/ports'
import { CodePurpose } from '@/modules/auth/domain'
import {
    AUTH_JOBS,
    SendCodeJob,
    PasswordChangedJob,
    PasswordAddedJob,
    SignInMethodAddedJob,
    DeletionScheduledJob,
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
        email: CodeEmail
    ): Promise<void> {
        const job: SendCodeJob = {
            to,
            code,
            purpose,
            expiresInMinutes,
            language: email.language,
            accountExists: email.accountExists,
            firstPassword: email.firstPassword,
            name: email.name
        }
        await this.queue.add(AUTH_JOBS.SEND_CODE, job, EMAIL_JOB_OPTIONS)
    }

    async sendPasswordChanged(to: string, language: EmailLanguage): Promise<void> {
        const job: PasswordChangedJob = { to, language }
        await this.queue.add(AUTH_JOBS.PASSWORD_CHANGED, job, EMAIL_JOB_OPTIONS)
    }

    async sendPasswordAdded(to: string, language: EmailLanguage): Promise<void> {
        const job: PasswordAddedJob = { to, language }
        await this.queue.add(AUTH_JOBS.PASSWORD_ADDED, job, EMAIL_JOB_OPTIONS)
    }

    async sendSignInMethodAdded(to: string, providerName: string, language: EmailLanguage): Promise<void> {
        const job: SignInMethodAddedJob = { to, providerName, language }
        await this.queue.add(AUTH_JOBS.SIGN_IN_METHOD_ADDED, job, EMAIL_JOB_OPTIONS)
    }

    async sendDeletionScheduled(to: string, deletesAt: Date, timeZone: string, language: EmailLanguage): Promise<void> {
        const job: DeletionScheduledJob = { to, deletesAt: deletesAt.toISOString(), timeZone, language }
        await this.queue.add(AUTH_JOBS.DELETION_SCHEDULED, job, EMAIL_JOB_OPTIONS)
    }
}
