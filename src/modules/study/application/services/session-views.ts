import { RoomSession } from '@/modules/servers'
import { FocusSession } from '../../domain'

/**
 * A session as the clients get it, in REST and in `focus_session.*`
 * (D-220, D-222): where it is, with the server's clock (`serverTime`) the
 * client takes its offset from (D-18). A room's session is what GET /servers
 * lists (RoomSession), and more.
 */
export interface FocusSessionView extends RoomSession {
    kind: FocusSession['kind']
    channelId: string | null
    /** While waiting (a Solo): when it ends by itself. */
    waitingUntil: Date | null
    endedAt: Date | null
    endedReason: FocusSession['endedReason']
    /** A Solo's seconds counted so far (D-234); null for a Room Session. */
    countedSeconds: number | null
}

export function sessionView(session: FocusSession, now: Date): FocusSessionView {
    const { cycle } = session
    return {
        id: session.id,
        kind: session.kind,
        channelId: session.channelId,
        hostId: session.hostId,
        focusMinutes: cycle.focusMinutes,
        shortBreakMinutes: cycle.shortBreakMinutes,
        longBreakMinutes: cycle.longBreakMinutes,
        longBreakEvery: cycle.longBreakEvery,
        status: session.status,
        phase: session.phase,
        phaseIndex: session.phaseIndex,
        phaseStartedAt: session.phaseStartedAt,
        phaseEndsAt: session.phaseEndsAt,
        pausedRemainingMs: session.pausedRemainingMs,
        waitingUntil: session.waitingUntil,
        stretchStartedAt: session.stretchStartedAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        endedReason: session.endedReason,
        countedSeconds: session.countedSeconds,
        version: session.version,
        serverTime: now
    }
}
