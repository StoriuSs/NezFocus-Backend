import { CallInProgressError } from './errors/call.errors'

/**
 * One-to-one calls (REQ-SOCIAL-05, SOCIAL-06, D-120, D-242, D-245): pure
 * rules, no I/O. Each command is decided on the open calls (ringing or
 * active) of the people it locks, read under their locks, and answers what
 * to write: a call to make, calls to change, and which call is the answer.
 *
 * A person is in one of two states (D-245): one call they make or are in
 * (ringing out, or active), or up to two calls ringing to them. Every rule
 * below keeps it so.
 */

export type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'failed'

/** Why a call was missed: nobody answered in 45 seconds, its caller hung up, or its callee was busy. */
export type CallEndReason = 'no_answer' | 'cancelled' | 'busy'

/** A call as the rules read it. */
export interface Call {
    id: string
    /** The DM it belongs to (its channel id). */
    dmChannelId: string
    callerId: string
    calleeId: string
    /** Started as a video call. */
    video: boolean
    status: CallStatus
    /** Only on `missed`. */
    endReason: CallEndReason | null
    /** Raised by every change: a timed job set for an older one does nothing (D-242). */
    version: number
    createdAt: Date
    acceptedAt: Date | null
    endedAt: Date | null
}

/** Every status, for the API's list of values. */
export const CALL_STATUSES: readonly CallStatus[] = ['ringing', 'active', 'ended', 'declined', 'missed', 'failed']

/** Every reason a missed call may give. */
export const CALL_END_REASONS: readonly CallEndReason[] = ['no_answer', 'cancelled', 'busy']

/** How long a call rings before it is missed (REQ-SOCIAL-05). */
export const RING_MS = 45 * 1000

/** How many calls may ring to one person at once (spec 09: two cards; a third caller finds them busy). */
export const MAX_INCOMING = 2

/** What a call becomes: answered, or one of the final statuses with its reason. */
export type CallOutcome =
    | { status: 'active'; acceptedAt: Date }
    | { status: 'ended' | 'declined' | 'failed'; endReason: null; endedAt: Date }
    | { status: 'missed'; endReason: CallEndReason; endedAt: Date }

/** A call to change, from the version it was read at. */
export interface CallChange {
    call: Call
    to: CallOutcome
}

/** A call to make: ringing, or missed at once because its callee is busy. */
export interface NewCall {
    dmChannelId: string
    callerId: string
    calleeId: string
    video: boolean
    status: 'ringing' | 'missed'
    endReason: 'busy' | null
    /** Its time of ringing; also its end when it is missed at once. */
    at: Date
}

/** What a command writes; `answer` is the call it answers with: one of those read, or the one made (`new`). */
export interface CallPlan {
    create: NewCall | null
    changes: CallChange[]
    answer: string | 'new'
}

export const isOpenCall = (call: Call): boolean => call.status === 'ringing' || call.status === 'active'

/** The call `userId` makes or is in: theirs ringing out, or one active with them in it. */
export function currentCallOf(open: Call[], userId: string): Call | null {
    return (
        open.find(
            (call) =>
                (call.status === 'ringing' && call.callerId === userId) ||
                (call.status === 'active' && (call.callerId === userId || call.calleeId === userId))
        ) ?? null
    )
}

/** The calls ringing to `userId`, oldest first. */
export const incomingCallsOf = (open: Call[], userId: string): Call[] =>
    open
        .filter((call) => call.status === 'ringing' && call.calleeId === userId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

/** Whether someone called now is busy (D-120): in a call, ringing out, or rung by two already. */
export const isBusy = (open: Call[], userId: string): boolean =>
    currentCallOf(open, userId) !== null || incomingCallsOf(open, userId).length >= MAX_INCOMING

const missedBusy = (at: Date): CallOutcome => ({ status: 'missed', endReason: 'busy', endedAt: at })

/** Nothing changes: the command answers with the call as it is (D-245). */
const unchanged = (callId: string): CallPlan => ({ create: null, changes: [], answer: callId })

/** `call` answered by its callee: active now, and the other calls ringing to them missed as busy (D-120). */
function answer(call: Call, open: Call[], at: Date): CallPlan {
    const others = incomingCallsOf(open, call.calleeId).filter((other) => other.id !== call.id)
    return {
        create: null,
        changes: [
            { call, to: { status: 'active', acceptedAt: at } },
            ...others.map((other) => ({ call: other, to: missedBusy(at) }))
        ],
        answer: call.id
    }
}

/** A call asked for, in a DM of the two. */
export interface CallRequest {
    dmChannelId: string
    callerId: string
    calleeId: string
    video: boolean
}

/**
 * Calling someone in our DM (REQ-SOCIAL-05, D-120, D-242, D-245), on the
 * open calls of the two:
 * - an open call in this DM already: theirs ringing to me is answered (two
 *   calling each other at once meet in one call); mine ringing, or the one
 *   we are in, is the answer as it is (a second click, another tab);
 * - me in another call, or ringing out: CallInProgressError;
 * - them busy: a call made missed at once (`busy`), no ring; they get the
 *   missed call in their inbox, mine stays as it was;
 * - else a call made ringing, and the calls ringing to me missed as busy
 *   (D-245: calling out is answering none of them).
 * @throws CallInProgressError
 */
export function decideStart(request: CallRequest, open: Call[], at: Date): CallPlan {
    const { dmChannelId, callerId, calleeId, video } = request
    const here = open.find((call) => call.dmChannelId === dmChannelId)
    if (here) {
        if (here.status === 'ringing' && here.calleeId === callerId) return answer(here, open, at)
        return unchanged(here.id)
    }
    if (currentCallOf(open, callerId)) throw new CallInProgressError(callerId)
    const made = { dmChannelId, callerId, calleeId, video, at }
    if (isBusy(open, calleeId)) {
        return { create: { ...made, status: 'missed', endReason: 'busy' }, changes: [], answer: 'new' }
    }
    return {
        create: { ...made, status: 'ringing', endReason: null },
        changes: incomingCallsOf(open, callerId).map((call) => ({ call, to: missedBusy(at) })),
        answer: 'new'
    }
}

/** The call `callId` among those read: open, or null once it is final (it is no longer read). */
const openCall = (open: Call[], callId: string): Call | null => open.find((call) => call.id === callId) ?? null

/**
 * Its callee answers (REQ-SOCIAL-05): a call still ringing becomes active,
 * and the others ringing to them are missed as busy (D-120). Anything else
 * (its caller asking, a call cancelled or missed meanwhile) changes nothing.
 */
export function decideAccept(callId: string, userId: string, open: Call[], at: Date): CallPlan {
    const call = openCall(open, callId)
    if (!call || call.status !== 'ringing' || call.calleeId !== userId) return unchanged(callId)
    return answer(call, open, at)
}

/** Its callee declines a call still ringing: no inbox item (REQ-SOCIAL-06). Anything else changes nothing. */
export function decideDecline(callId: string, userId: string, open: Call[], at: Date): CallPlan {
    const call = openCall(open, callId)
    if (!call || call.status !== 'ringing' || call.calleeId !== userId) return unchanged(callId)
    return {
        create: null,
        changes: [{ call, to: { status: 'declined', endReason: null, endedAt: at } }],
        answer: callId
    }
}

/**
 * Either of the two hangs up (D-242): ringing, its caller cancels it
 * (missed, `cancelled`, an inbox item for the callee) and its callee
 * declines it; active, it ends. A call final already changes nothing.
 */
export function decideEnd(callId: string, userId: string, open: Call[], at: Date): CallPlan {
    const call = openCall(open, callId)
    if (!call) return unchanged(callId)
    const to: CallOutcome =
        call.status === 'active'
            ? { status: 'ended', endReason: null, endedAt: at }
            : call.callerId === userId
              ? { status: 'missed', endReason: 'cancelled', endedAt: at }
              : { status: 'declined', endReason: null, endedAt: at }
    return { create: null, changes: [{ call, to }], answer: callId }
}

/**
 * 45 seconds of ringing are over (REQ-SOCIAL-05): the call is missed
 * (`no_answer`) if it still rings at the version its job was set for;
 * answered, ended, or changed since, nothing happens.
 */
export function decideRingOut(callId: string, version: number, open: Call[], at: Date): CallPlan {
    const call = openCall(open, callId)
    if (!call || call.status !== 'ringing' || call.version !== version) return unchanged(callId)
    return {
        create: null,
        changes: [{ call, to: { status: 'missed', endReason: 'no_answer', endedAt: at } }],
        answer: callId
    }
}

/**
 * A call cut off from outside (D-242): a block between the two, either
 * way, or one of them starting to wait for deletion. Active, it ends as
 * any call does (nobody told why, SOCIAL-03); ringing, it is missed as
 * cancelled. A call final already changes nothing.
 */
export function decideCutOff(callId: string, open: Call[], at: Date): CallPlan {
    const call = openCall(open, callId)
    if (!call) return unchanged(callId)
    const to: CallOutcome =
        call.status === 'active'
            ? { status: 'ended', endReason: null, endedAt: at }
            : { status: 'missed', endReason: 'cancelled', endedAt: at }
    return { create: null, changes: [{ call, to }], answer: callId }
}

/**
 * How long a call lasted, in whole seconds (D-242: from answering to its
 * end); null for one never answered, or one that failed to connect
 * (D-120: no length).
 */
export function callSeconds(call: Pick<Call, 'status' | 'acceptedAt' | 'endedAt'>): number | null {
    if (call.status !== 'ended' || !call.acceptedAt || !call.endedAt) return null
    return Math.max(0, Math.floor((call.endedAt.getTime() - call.acceptedAt.getTime()) / 1000))
}
