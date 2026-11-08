import { JobsOptions } from 'bullmq'
import { CodePurpose } from '@/modules/auth/domain'
import type { EmailLanguage } from '@/modules/auth/application/ports'

/*
 * The auth email jobs on the `auth` queue: their names, what each carries, and
 * how they are retried. One contract for both sides: BullMqAuthMailer adds
 * them, AuthJobsConsumer sends them.
 * A job already in Redis was written with an earlier version of these, so a
 * field added later stays optional: `language` absent means English.
 */

export const AUTH_JOBS = {
    SEND_CODE: 'send-code',
    PASSWORD_CHANGED: 'password-changed',
    PASSWORD_ADDED: 'password-added',
    SIGN_IN_METHOD_ADDED: 'sign-in-method-added',
    DELETION_SCHEDULED: 'account-deletion-scheduled'
} as const

interface Localised {
    to: string
    language?: EmailLanguage
}

export interface SendCodeJob extends Localised {
    code: string
    purpose: CodePurpose
    expiresInMinutes: number
    /** A sign-in code: the address has an account. */
    accountExists?: boolean
    /** A reset code for an account with no password yet. */
    firstPassword?: boolean
    /** The account's display name, when it has one. */
    name?: string
}

export type PasswordChangedJob = Localised

export type PasswordAddedJob = Localised

export interface SignInMethodAddedJob extends Localised {
    providerName: string
}

export interface DeletionScheduledJob extends Localised {
    /** ISO 8601: when the account goes. */
    deletesAt: string
    /** The account's IANA time zone, to write that date in. */
    timeZone: string
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
