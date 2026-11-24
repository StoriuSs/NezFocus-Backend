import { Call, CallOutcome, CallPlan } from './call.rules'

/**
 * A call's media room (`call:<id>`, D-239, D-242): who of its two is in it,
 * as LiveKit's webhooks and lists say, and what time does to an answered
 * call nobody connected to, or one somebody left. Pure rules, no I/O.
 */

/** How long both have from answering to come into the room before the call fails (REQ-SOCIAL-05, D-120). */
export const CONNECT_MS = 15 * 1000

/** How long one out of the room may take to come back before the call ends (REQ-SOCIAL-05). */
export const DROP_MS = 30 * 1000

/**
 * A connection joined less than this before LiveKit was read may not be
 * listed yet, or its webhook still on its way: the reconciliation leaves
 * its row alone (as RECONCILE_GRACE_MS of voice, D-210).
 */
export const MEDIA_GRACE_MS = 60 * 1000

/** One person's latest connection to a call's room: a CallParticipant row. */
export interface CallPresence {
    userId: string
    /** LiveKit's id of the connection. */
    participantSid: string
    joinedAt: Date
    /** When it left; null while in. */
    leftAt: Date | null
    /** The sign-in session of its token (D-214); null for a token without one. */
    sessionId: string | null
}

/** A connection the media server has in a call's room now. */
export interface LiveConnection {
    userId: string
    participantSid: string
    joinedAt: Date
    sessionId: string | null
}

/** What happened in a call's room: someone's connection came in, or went. */
export type CallMediaChange =
    | ({ kind: 'joined' } & LiveConnection)
    | { kind: 'left'; userId: string; participantSid: string; at: Date }

/** What a change writes: a person's row as it is to be (null: nothing), and whether to put the connection out. */
export interface MediaWrite {
    write: CallPresence | null
    evict: boolean
}

const nothing: MediaWrite = { write: null, evict: false }

const isParty = (call: Call, userId: string) => call.callerId === userId || call.calleeId === userId

/**
 * A change in a call's room on the call and its rows (D-242), as voice
 * keeps VoiceState (D-210):
 * - a join to a call not active (ringing, over, none) or of someone not of
 *   it is put out, nothing written;
 * - a party's join writes their row, unless it is of a connection older
 *   than the row's (late), or the row's own (taken already, or gone: a list
 *   read before its leave never brings it back);
 * - a leave marks the row out, only for the row's own connection still in.
 * Once the call is over its room is closed: leaves change nothing.
 */
export function mediaWrite(call: Call | null, presence: CallPresence[], change: CallMediaChange): MediaWrite {
    const active = call?.status === 'active'
    const current = presence.find((row) => row.userId === change.userId) ?? null
    if (change.kind === 'left') {
        if (!active || current?.participantSid !== change.participantSid || current.leftAt) return nothing
        return { write: { ...current, leftAt: change.at }, evict: false }
    }
    if (!active || !isParty(call, change.userId)) return { write: null, evict: true }
    if (current && (current.participantSid === change.participantSid || current.joinedAt > change.joinedAt)) {
        return nothing
    }
    const { userId, participantSid, joinedAt, sessionId } = change
    return { write: { userId, participantSid, joinedAt, leftAt: null, sessionId }, evict: false }
}

/** When an active call's media ends it unless something changes, and how. */
export interface MediaDeadline {
    at: Date
    to: CallOutcome
}

/**
 * The deadline of an active call (REQ-SOCIAL-05, D-120, D-242): not both
 * of its two in the room yet (each with a row: in once at least), it fails
 * 15 seconds after answering, with no length; both in once, and one of
 * them out, it ends 30 seconds after the first of those out left, at the
 * time they left; both in, none. Not active: none.
 */
export function mediaDeadline(call: Call, presence: CallPresence[]): MediaDeadline | null {
    if (call.status !== 'active' || !call.acceptedAt) return null
    const both = [call.callerId, call.calleeId].every((userId) => presence.some((row) => row.userId === userId))
    if (!both) {
        const at = new Date(call.acceptedAt.getTime() + CONNECT_MS)
        return { at, to: { status: 'failed', endReason: null, endedAt: at } }
    }
    const outSince = presence
        .map((row) => row.leftAt)
        .filter((leftAt): leftAt is Date => leftAt !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0]
    if (!outSince) return null
    return {
        at: new Date(outSince.getTime() + DROP_MS),
        to: { status: 'ended', endReason: null, endedAt: outSince }
    }
}

const unchanged = (callId: string): CallPlan => ({ create: null, changes: [], answer: callId })

/**
 * The media job of a call ran (D-242): set for `version`, it ends the call
 * as its deadline says once that has passed. A call changed since (someone
 * came in or went: a newer job stands), over, or whose deadline is not
 * reached changes nothing. `presence` is read before the call's locks: the
 * version, read under them, tells whether it is still the call's.
 */
export function decideMediaTimeout(
    callId: string,
    version: number,
    presence: CallPresence[],
    open: Call[],
    now: Date
): CallPlan {
    const call = open.find((one) => one.id === callId)
    if (!call || call.version !== version) return unchanged(callId)
    const deadline = mediaDeadline(call, presence)
    if (!deadline || deadline.at > now) return unchanged(callId)
    return { create: null, changes: [{ call, to: deadline.to }], answer: callId }
}

/**
 * What a call room's rows lack against what the media server has now
 * (D-210, D-242), as changes for mediaWrite: a leave, at `now`, for a row
 * in the room whose connection is no longer listed (unless it joined within
 * MEDIA_GRACE_MS of the read), then a join for each connection listed.
 * Joins the rows have already change nothing there; one of someone not of
 * the call is put out there. The rows are to be read before the list.
 */
export function callMediaFixes(presence: CallPresence[], live: LiveConnection[], now: Date): CallMediaChange[] {
    const listed = new Set(live.map((connection) => connection.participantSid))
    const leaves: CallMediaChange[] = presence
        .filter(
            (row) =>
                !row.leftAt &&
                !listed.has(row.participantSid) &&
                now.getTime() - row.joinedAt.getTime() >= MEDIA_GRACE_MS
        )
        .map((row) => ({ kind: 'left', userId: row.userId, participantSid: row.participantSid, at: now }))
    const joins: CallMediaChange[] = live
        .filter(
            (connection) =>
                !presence.some(
                    (row) => row.userId === connection.userId && row.participantSid === connection.participantSid
                )
        )
        .map((connection) => ({ kind: 'joined', ...connection }))
    return [...leaves, ...joins]
}
