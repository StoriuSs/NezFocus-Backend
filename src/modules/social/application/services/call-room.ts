import { Logger } from '@nestjs/common'
import type { CallMediaPort } from '@/modules/voice'
import {
    CallMediaChange,
    CallPresence,
    CallRecord,
    callMediaFixes,
    decideMediaTimeout,
    isOpenCall,
    mediaDeadline,
    mediaWrite
} from '../../domain'
import { CallJobsPort } from '../ports'
import { CallSources, changeCalls } from './change-calls'

/** What a call's media needs besides changing calls: the room at LiveKit, through voice (D-239). */
export interface MediaSources extends CallSources {
    media: CallMediaPort
}

const logger = new Logger('CallMedia')

/**
 * Sets the media job of a call whose room just changed (D-242): the one set
 * for the version before goes, and one for the new version is set at the
 * call's deadline, if it has one. A job not set (Redis down) is logged: the
 * sweep runs a deadline gone by.
 */
async function setMediaCheck(jobs: CallJobsPort, call: CallRecord, presence: CallPresence[]): Promise<void> {
    try {
        await jobs.dropMediaCheck(call.id, call.version - 1)
        const deadline = mediaDeadline(call, presence)
        if (deadline) await jobs.checkMediaAt(call.id, call.version, deadline.at)
    } catch (error) {
        logger.warn(`The media check of call ${call.id} not set: ${(error as Error)?.message}`)
    }
}

/**
 * A connection came into a call's room or went (D-242): written as
 * mediaWrite says, under the call's locks, its media job set again; one
 * that should not be there (the call not active, someone not of it) is put
 * out of the room. LiveKit unreachable throws, the row written. True when
 * it changed something: a row written, or a connection put out.
 */
export async function recordMedia(sources: MediaSources, callId: string, change: CallMediaChange): Promise<boolean> {
    const { call, presence, written, evict } = await sources.calls.recordMedia(callId, (current, rows) =>
        mediaWrite(current, rows, change)
    )
    if (written && call) await setMediaCheck(sources.jobs, call, presence)
    if (evict) await sources.media.removeConnection(callId, change.userId, change.participantSid)
    return written || evict
}

/**
 * The media job of a call ran, or the sweep found its deadline gone by
 * (D-242): ended or failed as decideMediaTimeout says, if it is still at
 * `version`. True when this run ended it.
 */
export async function checkMedia(sources: MediaSources, callId: string, version: number, now: Date): Promise<boolean> {
    const call = await sources.calls.find(callId)
    if (!call || call.status !== 'active' || call.version !== version) return false
    const presence = (await sources.calls.presenceOf([callId])).get(callId) ?? []
    const after = await changeCalls(sources, [call.callerId, call.calleeId], (open) =>
        decideMediaTimeout(callId, version, presence, open, now)
    )
    return !isOpenCall(after) && after.version === version + 1
}

/** What one sweep of the call rooms did. */
export interface CallMediaSwept {
    /** Calls ended or failed by a deadline whose job was lost or late. */
    timedOut: number
    /** Joins and leaves written that LiveKit's webhooks had not told. */
    fixed: number
    /** Rooms closed that no active call has. */
    closed: number
}

/**
 * The call rooms set right every minute (D-242, D-246), as voice does its
 * rooms (D-210): LiveKit's rooms read first, then the active calls and
 * their rows, then each one's people, so a room or a row is only judged
 * against a list read after it. A deadline gone by is run (a lost job); the
 * joins and leaves the webhooks lost are written (callMediaFixes); a room
 * with no active call (its close not reaching LiveKit) is closed.
 *
 * Each call, and each room closed, on its own: one that fails is logged and
 * left for the next run, the others go on. LiveKit unreachable closes no
 * room and fixes no row, but the deadlines, which need only the rows, still
 * run. The database unreachable throws.
 */
export async function sweepCallMedia(sources: MediaSources, now: Date): Promise<CallMediaSwept> {
    const swept: CallMediaSwept = { timedOut: 0, fixed: 0, closed: 0 }
    const rooms = await sources.media.rooms().catch((error: unknown) => {
        logger.warn(`The call rooms of LiveKit not read: ${String(error)}`)
        return null
    })
    const active = await sources.calls.activeCalls()
    const presence = await sources.calls.presenceOf(active.map((call) => call.id))
    for (const call of active) {
        try {
            const rows = presence.get(call.id) ?? []
            const deadline = mediaDeadline(call, rows)
            if (deadline && deadline.at <= now) {
                if (await checkMedia(sources, call.id, call.version, now)) swept.timedOut++
                continue
            }
            for (const change of callMediaFixes(rows, await sources.media.participants(call.id), now)) {
                if (await recordMedia(sources, call.id, change)) swept.fixed++
            }
        } catch (error) {
            logger.warn(`The room of call ${call.id} not swept: ${String(error)}`)
        }
    }
    const activeIds = new Set(active.map((call) => call.id))
    for (const callId of (rooms ?? []).filter((id) => !activeIds.has(id))) {
        try {
            await sources.media.close(callId)
            swept.closed++
        } catch (error) {
            logger.warn(`The room of call ${callId} not closed: ${String(error)}`)
        }
    }
    return swept
}
