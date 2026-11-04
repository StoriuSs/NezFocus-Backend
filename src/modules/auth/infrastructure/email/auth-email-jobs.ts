import { JobsOptions } from 'bullmq'
import { CodePurpose } from '@/modules/auth/domain'

/*
 * The auth email jobs on the `auth` queue: their names, what each carries, and
 * how they are retried. One contract for both sides: BullMqAuthMailer adds
 * them, AuthJobsConsumer sends them (and the two-factor-off CLI adds one).
 * A job already in Redis was written with an earlier version of these, so a
 * field added later stays optional.
 */

export const AUTH_JOBS = {
    SEND_CODE: 'send-code',
    PASSWORD_CHANGED: 'password-changed',
    ACCOUNT_EXISTS: 'account-exists',
    PASSWORD_ADDED: 'password-added',
    SIGN_IN_METHOD_ADDED: 'sign-in-method-added',
    TWO_FACTOR_CHANGED: 'two-factor-changed',
    RECOVERY_CODE_USED: 'recovery-code-used',
    RECOVERY_CODES_REPLACED: 'recovery-codes-replaced',
    ACCOUNT_DELETED: 'account-deleted'
} as const

export interface SendCodeJob {
    to: string
    code: string
    purpose: CodePurpose
    expiresInMinutes: number
    /** Absent on a job queued before it existed: worded as a reset. */
    firstPassword?: boolean
    /** The account's display name, when it has one. */
    name?: string
}

export interface PasswordChangedJob {
    to: string
}

export interface AccountExistsJob {
    to: string
    /** Absent on a job queued before these existed: the email then names no method. */
    password?: boolean
    providers?: string[]
}

export interface PasswordAddedJob {
    to: string
}

export interface SignInMethodAddedJob {
    to: string
    providerName: string
}

export interface TwoFactorChangedJob {
    to: string
    enabled: boolean
}

export interface AccountDeletedJob {
    to: string
}

export interface RecoveryCodesReplacedJob {
    to: string
}

export interface RecoveryCodeUsedJob {
    to: string
    remaining: number
}

/**
 * Overrides the queue defaults, which suit work that can wait an hour and a
 * half. A code expires in minutes: three quick tries, then give up. And a
 * sent code is removed at once rather than kept a day in Redis — the job
 * holds the code itself.
 */
export const EMAIL_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 60 * 60 }
}
