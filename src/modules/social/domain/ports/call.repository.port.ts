import type { ShownPerson } from '@/shared/domain'
import type { Call, CallPlan, CallStatus } from '../call.rules'

/** A call with its two people as others see them (D-182: a deleted account, or one waiting to be, has no name). */
export interface CallRecord extends Call {
    caller: ShownPerson
    callee: ShownPerson
}

/** One call a command changed: as it is now, and its status before (null: made now). */
export interface ChangedCall {
    call: CallRecord
    before: CallStatus | null
}

/** What a command did: every call it made or changed, and the call it answers with as it is now. */
export interface CallChanges {
    changed: ChangedCall[]
    answer: CallRecord
}

/**
 * Call Repository Port — the Call rows (ARCHITECTURE 6, D-242). Every
 * change runs under the advisory locks of the people it is about
 * (`call:<userId>`, smaller id first, D-242), so two commands touching one
 * person take turns, the second reading what the first wrote: two people
 * calling each other at once meet in one call, two calls to one person
 * find them busy once. The partial unique index (one open call per DM) is
 * the last guard.
 */
export interface CallRepositoryPort {
    /** The call, final or not; null when there is none. */
    find(callId: string): Promise<CallRecord | null>
    /** The open calls (ringing or active) the person makes or receives, oldest first. */
    openOf(userId: string): Promise<CallRecord[]>
    /**
     * Under the locks of `userIds`: reads their open calls, asks `decide`
     * what to write (a CallPlan of call.rules), writes it in one
     * transaction (a change applies only at the version it was read at),
     * and answers what it did. `decide` throwing writes nothing.
     */
    change(userIds: string[], decide: (open: Call[]) => CallPlan): Promise<CallChanges>
    /** The calls still ringing that started before `before` (a lost 45-second job, D-242): id and version. */
    ringingSince(before: Date): Promise<{ id: string; version: number }[]>
}

export const CALL_REPOSITORY = Symbol('CallRepositoryPort')
