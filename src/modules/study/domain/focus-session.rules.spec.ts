import {
    caughtUp,
    continueMove,
    Cycle,
    cycleMove,
    FIRST_SOLO_CYCLE,
    firstClock,
    FocusSession,
    mayControl,
    mayStart,
    pauseMove,
    phaseEndMove,
    phaseOf,
    resumeMove,
    skipMove,
    stopMove,
    timerDueAt,
    WAIT_MINUTES
} from './focus-session.rules'

const MINUTE = 60_000
const at = (time: string) => new Date(`2026-11-21T${time}Z`)
const POMODORO: Cycle = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 }
const PLAIN: Cycle = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: null, longBreakEvery: null }

/** A session started at 20:00 with `cycle`, as the repository reads it. */
function session(cycle: Cycle = PLAIN, start = at('20:00:00')): FocusSession {
    return {
        id: 's',
        kind: 'room',
        serverId: 'server',
        channelId: 'room',
        hostId: 'an',
        userId: null,
        cycle,
        version: 0,
        startedAt: start,
        stretchStartedAt: start,
        emptySince: null,
        ...firstClock(cycle, start, MINUTE)
    }
}

/** The session after a move, as the repository would write it. */
const after = (before: FocusSession, move: { clock: FocusSession; cycle: Cycle } | null): FocusSession => {
    if (!move) throw new Error('no move')
    return { ...before, ...move.clock, cycle: move.cycle, version: before.version + 1 }
}

describe('phaseOf', () => {
    it('takes focus and breaks in turn, a long break after every 4th focus phase', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => phaseOf(index, POMODORO))).toEqual([
            'focus',
            'short_break',
            'focus',
            'short_break',
            'focus',
            'short_break',
            'focus',
            'long_break',
            'focus',
            'short_break'
        ])
    })

    it('never gives a long break in a cycle with none', () => {
        expect(phaseOf(7, PLAIN)).toBe('short_break')
    })
})

describe('firstClock', () => {
    it('runs the first focus phase for its length from the start', () => {
        expect(firstClock(PLAIN, at('20:00:00'), MINUTE)).toMatchObject({
            status: 'running',
            phase: 'focus',
            phaseIndex: 0,
            phaseStartedAt: at('20:00:00'),
            phaseEndsAt: at('20:25:00'),
            pausedRemainingMs: null
        })
    })

    it('makes a study minute STUDY_MINUTE_MS long (D-221)', () => {
        expect(firstClock(PLAIN, at('20:00:00'), 1000).phaseEndsAt).toEqual(at('20:00:25'))
    })
})

describe('pause and resume (REQ-STUDY-03)', () => {
    it('keeps 10:00 when paused with 10:00 left, and shows 10:00 again when resumed 3 minutes later', () => {
        const paused = pauseMove(session(), at('20:15:00'))
        expect(paused).toMatchObject({
            clock: { status: 'paused', phaseEndsAt: null, pausedRemainingMs: 10 * MINUTE },
            stretches: [{ close: at('20:15:00') }]
        })
        const resumed = resumeMove(after(session(), paused as never), at('20:18:00'))
        expect(resumed).toMatchObject({
            clock: { status: 'running', phaseEndsAt: at('20:28:00'), pausedRemainingMs: null },
            stretches: [{ open: at('20:18:00') }]
        })
    })

    it('closes no stretch when a break is paused, and opens none when it is resumed', () => {
        const onBreak = after(session(), phaseEndMove(session(), MINUTE) as never)
        const paused = pauseMove(onBreak, at('20:27:00'))
        expect(paused?.stretches).toEqual([])
        expect(resumeMove(after(onBreak, paused as never), at('20:30:00'))?.stretches).toEqual([])
    })

    it('closes the stretch at the end its phase was due when paused before the late job (D-224)', () => {
        expect(pauseMove(session(), at('20:25:04'))).toMatchObject({
            clock: { pausedRemainingMs: 0 },
            stretches: [{ close: at('20:25:00') }]
        })
    })

    it('does nothing to a session already paused, or one paused resumed again', () => {
        const paused = after(session(), pauseMove(session(), at('20:15:00')) as never)
        expect(pauseMove(paused, at('20:16:00'))).toBeNull()
        expect(resumeMove(session(), at('20:16:00'))).toBeNull()
    })
})

describe('skip', () => {
    it('ends a running focus phase now and runs the break from now', () => {
        expect(skipMove(session(), at('20:12:40'), MINUTE)).toMatchObject({
            clock: {
                status: 'running',
                phase: 'short_break',
                phaseIndex: 1,
                phaseStartedAt: at('20:12:40'),
                phaseEndsAt: at('20:17:40')
            },
            stretches: [{ close: at('20:12:40') }]
        })
    })

    it('opens a stretch when a break is skipped into focus', () => {
        const onBreak = after(session(), skipMove(session(), at('20:10:00'), MINUTE) as never)
        expect(skipMove(onBreak, at('20:11:00'), MINUTE)).toMatchObject({
            clock: { phase: 'focus', phaseIndex: 2, phaseEndsAt: at('20:36:00') },
            stretches: [{ open: at('20:11:00') }]
        })
    })

    it('keeps the next phase paused, for its whole length, when skipped while paused (REQ-STUDY-03)', () => {
        const paused = after(session(), pauseMove(session(), at('20:15:00')) as never)
        expect(skipMove(paused, at('20:16:00'), MINUTE)).toMatchObject({
            clock: { status: 'paused', phase: 'short_break', pausedRemainingMs: 5 * MINUTE, phaseEndsAt: null },
            stretches: []
        })
    })

    it('does nothing to an ended session', () => {
        const ended = after(session(), stopMove(session(), at('20:10:00'), 'stopped') as never)
        expect(skipMove(ended, at('20:11:00'), MINUTE)).toBeNull()
    })
})

describe('the end of a phase, by its job (ARCHITECTURE 5.1)', () => {
    it('begins the next phase when the last one was due, not when the job runs', () => {
        expect(phaseEndMove(session(), MINUTE)).toMatchObject({
            at: at('20:25:00'),
            clock: { phase: 'short_break', phaseStartedAt: at('20:25:00'), phaseEndsAt: at('20:30:00') },
            stretches: [{ close: at('20:25:00') }]
        })
    })

    it('catches up a phase at a time after a long stop: each begins where the last was due (D-225)', () => {
        let current = session(POMODORO)
        const starts: string[] = []
        for (let i = 0; i < 8; i++) {
            const move = phaseEndMove(current, MINUTE)
            current = after(current, move as never)
            starts.push(`${current.phase}@${current.phaseStartedAt.toISOString().slice(11, 16)}`)
        }
        expect(starts).toEqual([
            'short_break@20:25',
            'focus@20:30',
            'short_break@20:55',
            'focus@21:00',
            'short_break@21:25',
            'focus@21:30',
            'long_break@21:55',
            'focus@22:10'
        ])
    })

    it('opens the stretch of a focus phase at its planned start', () => {
        const onBreak = after(session(), phaseEndMove(session(), MINUTE) as never)
        expect(phaseEndMove(onBreak, MINUTE)?.stretches).toEqual([{ open: at('20:30:00') }])
    })

    it('does nothing to a session not running', () => {
        expect(phaseEndMove(after(session(), pauseMove(session(), at('20:10:00')) as never), MINUTE)).toBeNull()
    })
})

describe('a command after a phase end its job missed (caughtUp, D-225)', () => {
    it('makes the missed phase end first, when it was due, then the command: no focus second lost', () => {
        // The break was due at 20:30; its job is lost; the Host stops at 20:30:20.
        const onBreak = after(session(), phaseEndMove(session(), MINUTE) as never)
        const stop = caughtUp(onBreak, at('20:30:20'), MINUTE, (current, now) => stopMove(current, now, 'stopped'))
        expect(stop).toMatchObject({
            at: at('20:30:20'),
            clock: { status: 'ended', phaseIndex: 2, phase: 'focus' },
            stretches: [{ open: at('20:30:00') }, { close: at('20:30:20') }]
        })
    })

    it('pauses the focus phase the room is really in, with what is left of it', () => {
        const onBreak = after(session(), phaseEndMove(session(), MINUTE) as never)
        const pause = caughtUp(onBreak, at('20:31:00'), MINUTE, pauseMove)
        expect(pause).toMatchObject({
            clock: { status: 'paused', phase: 'focus', pausedRemainingMs: 24 * MINUTE },
            stretches: [{ open: at('20:30:00') }, { close: at('20:31:00') }]
        })
    })

    it('catches up several phases, and keeps the catch-up when the command then changes nothing', () => {
        const resume = caughtUp(session(), at('21:01:00'), MINUTE, resumeMove)
        expect(resume).toMatchObject({
            clock: { status: 'running', phase: 'focus', phaseIndex: 4, phaseStartedAt: at('21:00:00') },
            stretches: [
                { close: at('20:25:00') },
                { open: at('20:30:00') },
                { close: at('20:55:00') },
                { open: at('21:00:00') }
            ]
        })
    })

    it('is the command alone when nothing was missed, and nothing when that changes nothing', () => {
        expect(caughtUp(session(), at('20:10:00'), MINUTE, pauseMove)).toEqual(pauseMove(session(), at('20:10:00')))
        expect(caughtUp(session(), at('20:10:00'), MINUTE, resumeMove)).toBeNull()
    })
})

describe('stop', () => {
    it('ends the session now, closing its stretch, with its reason', () => {
        const stopped = stopMove(
            after(session(), skipMove(session(), at('20:10:00'), MINUTE) as never),
            at('20:11:00'),
            'empty'
        )
        expect(stopped).toMatchObject({
            clock: { status: 'ended', endedAt: at('20:11:00'), endedReason: 'empty', phaseEndsAt: null },
            stretches: []
        })
        expect(stopMove(session(), at('20:12:00'), 'stopped')?.stretches).toEqual([{ close: at('20:12:00') }])
    })

    it('ends a paused session, and leaves an ended one alone', () => {
        const paused = after(session(), pauseMove(session(), at('20:15:00')) as never)
        const ended = after(paused, stopMove(paused, at('20:16:00'), 'stopped') as never)
        expect(ended).toMatchObject({ status: 'ended', pausedRemainingMs: null })
        expect(stopMove(ended, at('20:17:00'), 'stopped')).toBeNull()
    })
})

describe('a new cycle while paused (REQ-STUDY-03, D-50)', () => {
    const pausedAt = (base: FocusSession, time: string) => after(base, pauseMove(base, at(time)) as never)

    it('begins the phase again at the new length, still paused', () => {
        const fifty = { ...PLAIN, focusMinutes: 50, shortBreakMinutes: 10 }
        expect(cycleMove(pausedAt(session(), '20:15:00'), fifty, at('20:16:00'), MINUTE)).toMatchObject({
            cycle: fifty,
            clock: { status: 'paused', phase: 'focus', phaseStartedAt: at('20:16:00'), pausedRemainingMs: 50 * MINUTE },
            stretches: []
        })
    })

    it('makes a long break a short one in a cycle with none, and a short one long in a cycle that has one there', () => {
        let longBreak = session(POMODORO)
        for (let i = 0; i < 7; i++) longBreak = after(longBreak, phaseEndMove(longBreak, MINUTE) as never)
        expect(longBreak.phase).toBe('long_break')
        expect(cycleMove(pausedAt(longBreak, '22:00:00'), PLAIN, at('22:01:00'), MINUTE)?.clock).toMatchObject({
            phase: 'short_break',
            pausedRemainingMs: 5 * MINUTE
        })

        let shortBreak = session(PLAIN)
        for (let i = 0; i < 3; i++) shortBreak = after(shortBreak, phaseEndMove(shortBreak, MINUTE) as never)
        const everyTwo = { ...PLAIN, longBreakMinutes: 20, longBreakEvery: 2 }
        expect(cycleMove(pausedAt(shortBreak, '21:30:00'), everyTwo, at('21:31:00'), MINUTE)?.clock).toMatchObject({
            phase: 'long_break',
            pausedRemainingMs: 20 * MINUTE
        })
    })

    it('is refused while running (the caller says VALIDATION_ERROR)', () => {
        expect(cycleMove(session(), POMODORO, at('20:10:00'), MINUTE)).toBeNull()
    })
})

describe('who may do what (REQ-STUDY-01, STUDY-03, D-119)', () => {
    const anyone = { managesStudyRooms: false, inRoom: true }

    it('lets the Host and those with MANAGE_STUDY_ROOMS control, in the room or not', () => {
        expect(mayControl({ hostId: 'an' }, 'an', 'stop', anyone)).toBe(true)
        expect(mayControl({ hostId: 'an' }, 'chi', 'stop', { managesStudyRooms: true, inRoom: false })).toBe(true)
        expect(mayControl({ hostId: 'an' }, 'phong', 'pause', anyone)).toBe(false)
    })

    it('lets anyone in the room resume a session with no Host, and do nothing else', () => {
        expect(mayControl({ hostId: null }, 'phong', 'resume', anyone)).toBe(true)
        expect(mayControl({ hostId: null }, 'phong', 'resume', { ...anyone, inRoom: false })).toBe(false)
        expect(mayControl({ hostId: null }, 'phong', 'skip', anyone)).toBe(false)
        expect(mayControl({ hostId: 'an' }, 'phong', 'resume', anyone)).toBe(false)
    })

    it('lets anyone start where the room says anyone, and only managers where it says managers', () => {
        expect(mayStart('anyone', false)).toBe(true)
        expect(mayStart('managers', false)).toBe(false)
        expect(mayStart('managers', true)).toBe(true)
    })
})

describe('a Solo (REQ-STUDY-05)', () => {
    /** An's Solo started at 21:30 (25/5): its break runs 21:55 to 22:00. */
    const solo = (): FocusSession => ({
        ...session(PLAIN, at('21:30:00')),
        kind: 'solo',
        serverId: null,
        channelId: null,
        hostId: null,
        userId: 'an'
    })
    const onBreak = () => after(solo(), phaseEndMove(solo(), MINUTE) as never)
    const waiting = () => after(onBreak(), phaseEndMove(onBreak(), MINUTE) as never)

    it('waits WAIT_MINUTES once a break ends, instead of focusing again', () => {
        expect(WAIT_MINUTES).toBe(10)
        expect(phaseEndMove(onBreak(), MINUTE)).toMatchObject({
            at: at('22:00:00'),
            clock: {
                status: 'waiting',
                phase: 'short_break',
                phaseIndex: 1,
                phaseEndsAt: null,
                waitingUntil: at('22:10:00')
            },
            stretches: []
        })
    })

    it('begins a new focus phase when Học tiếp is pressed: ended 22:00, pressed 22:04, counted from 22:04', () => {
        expect(continueMove(waiting(), at('22:04:00'), MINUTE)).toMatchObject({
            at: at('22:04:00'),
            clock: {
                status: 'running',
                phase: 'focus',
                phaseIndex: 2,
                phaseStartedAt: at('22:04:00'),
                phaseEndsAt: at('22:29:00'),
                waitingUntil: null
            },
            stretches: [{ open: at('22:04:00') }]
        })
    })

    it('ends, as expired, at the end of its break once WAIT_MINUTES pass without Học tiếp', () => {
        expect(phaseEndMove(waiting(), MINUTE)).toMatchObject({
            at: at('22:00:00'),
            clock: { status: 'ended', endedAt: at('22:00:00'), endedReason: 'expired', waitingUntil: null },
            stretches: []
        })
    })

    it('goes straight into focus when a break is skipped, without waiting', () => {
        expect(skipMove(onBreak(), at('21:57:00'), MINUTE)).toMatchObject({
            clock: { status: 'running', phase: 'focus', phaseStartedAt: at('21:57:00') },
            stretches: [{ open: at('21:57:00') }]
        })
    })

    it('only continues while waiting; pause, resume, skip and a new cycle do nothing then, stop ends it now', () => {
        expect(continueMove(solo(), at('21:40:00'), MINUTE)).toBeNull()
        expect(continueMove(onBreak(), at('21:57:00'), MINUTE)).toBeNull()
        expect(pauseMove(waiting(), at('22:03:00'))).toBeNull()
        expect(resumeMove(waiting(), at('22:03:00'))).toBeNull()
        expect(skipMove(waiting(), at('22:03:00'), MINUTE)).toBeNull()
        expect(cycleMove(waiting(), POMODORO, at('22:03:00'), MINUTE)).toBeNull()
        expect(stopMove(waiting(), at('22:03:00'), 'stopped')).toMatchObject({
            clock: { status: 'ended', endedAt: at('22:03:00'), waitingUntil: null },
            stretches: []
        })
    })

    it('never makes a Room Session wait: its break ends into focus', () => {
        const roomBreak = after(session(), phaseEndMove(session(), MINUTE) as never)
        expect(phaseEndMove(roomBreak, MINUTE)?.clock.status).toBe('running')
    })

    it('makes a missed break end and expiry first when a command comes late (caughtUp, D-225)', () => {
        // The break end's job is lost: Học tiếp at 22:03 still begins focus then.
        expect(caughtUp(onBreak(), at('22:03:00'), MINUTE, (s, now) => continueMove(s, now, MINUTE))).toMatchObject({
            clock: { status: 'running', phase: 'focus', phaseStartedAt: at('22:03:00') },
            stretches: [{ open: at('22:03:00') }]
        })
        // Pressed at 22:10 sharp, as the wait ends: too late, as its job then is.
        expect(caughtUp(waiting(), at('22:10:00'), MINUTE, (s, now) => continueMove(s, now, MINUTE))).toMatchObject({
            clock: { status: 'ended', endedReason: 'expired' }
        })
        // Pressed at 22:15, past the wait: it ended at 22:00, and Học tiếp does nothing.
        expect(caughtUp(onBreak(), at('22:15:00'), MINUTE, (s, now) => continueMove(s, now, MINUTE))).toMatchObject({
            clock: { status: 'ended', endedReason: 'expired', endedAt: at('22:00:00') },
            stretches: []
        })
    })

    it('is due for its timer when its phase ends while running, when its wait ends while waiting, else never', () => {
        expect(timerDueAt(solo())).toEqual(at('21:55:00'))
        expect(timerDueAt(waiting())).toEqual(at('22:10:00'))
        expect(timerDueAt(after(solo(), pauseMove(solo(), at('21:40:00')) as never))).toBeNull()
    })

    it('starts with the 25/5 cycle with no long break when there was no Solo before', () => {
        expect(FIRST_SOLO_CYCLE).toEqual(PLAIN)
    })
})
