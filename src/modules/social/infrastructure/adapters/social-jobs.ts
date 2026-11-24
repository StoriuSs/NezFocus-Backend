/*
 * The jobs on the `social` queue: their names and what each carries. One
 * contract for both sides: BullMqCallJobs adds them, SocialJobsConsumer
 * runs them. Job data is JSON. A job already in Redis was written with an
 * earlier version of these, so a field added later stays optional.
 */

export const SOCIAL_JOBS = {
    /** A call still ringing 45 seconds on, missed (REQ-SOCIAL-05). */
    RING_OUT: 'call-ring-out',
    /** An answered call nobody connected to in 15 seconds, or somebody left 30 seconds ago, ended (D-242). */
    MEDIA_CHECK: 'call-media-check'
} as const

/** Only what to read again when it runs: the call, and the version it was set for (D-242). */
export interface CallVersionJob {
    callId: string
    version: number
}

export type RingOutJob = CallVersionJob
export type MediaCheckJob = CallVersionJob

export type SocialJob = CallVersionJob
