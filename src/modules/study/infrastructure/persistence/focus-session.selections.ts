import { Prisma } from '@/generated/prisma/client'
import { FocusSession, SessionClock } from '../../domain'

/** A session as the rules and the clients read it, with the focus stretch running now, if one does. */
export const SESSION = {
    id: true,
    kind: true,
    serverId: true,
    channelId: true,
    hostId: true,
    userId: true,
    focusMinutes: true,
    shortBreakMinutes: true,
    longBreakMinutes: true,
    longBreakEvery: true,
    status: true,
    phase: true,
    phaseIndex: true,
    phaseStartedAt: true,
    phaseEndsAt: true,
    pausedRemainingMs: true,
    waitingUntil: true,
    version: true,
    startedAt: true,
    endedAt: true,
    endedReason: true,
    emptySince: true,
    // One open at most (FocusStretch_one_open_per_session).
    stretches: { where: { endedAt: null }, select: { startedAt: true }, take: 1 }
} satisfies Prisma.FocusSessionSelect

export type SessionRow = Prisma.FocusSessionGetPayload<{ select: typeof SESSION }>

export function toSession(row: SessionRow): FocusSession {
    const { focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery, stretches, ...rest } = row
    return {
        ...rest,
        cycle: { focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery },
        stretchStartedAt: stretches[0]?.startedAt ?? null
    }
}

/** A session's clock as its columns. */
export const clockData = (clock: SessionClock) => ({
    status: clock.status,
    phase: clock.phase,
    phaseIndex: clock.phaseIndex,
    phaseStartedAt: clock.phaseStartedAt,
    phaseEndsAt: clock.phaseEndsAt,
    pausedRemainingMs: clock.pausedRemainingMs,
    waitingUntil: clock.waitingUntil,
    endedAt: clock.endedAt,
    endedReason: clock.endedReason
})
