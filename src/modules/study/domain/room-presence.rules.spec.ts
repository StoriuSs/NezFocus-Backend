import { Cycle, firstClock, FocusSession } from './focus-session.rules'
import {
    awayCloseDue,
    dueAt,
    emptyEndMove,
    joinMove,
    nextHost,
    Place,
    Present,
    presenceMove,
    selfEndMove
} from './room-presence.rules'

const MINUTE = 60_000
const at = (time: string) => new Date(`2026-11-21T${time}Z`)
const PLAIN: Cycle = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: null, longBreakEvery: null }

/** A Room Session started at 20:00, 25/5, empty since `emptySince`. */
function session(emptySince: Date | null = null): FocusSession {
    return {
        id: 's',
        kind: 'room',
        serverId: 'server',
        channelId: 'room',
        hostId: 'an',
        userId: null,
        cycle: PLAIN,
        version: 0,
        startedAt: at('20:00:00'),
        stretchStartedAt: at('20:00:00'),
        emptySince,
        ...firstClock(PLAIN, at('20:00:00'), MINUTE)
    }
}

const present = (userId: string, time: string): Present => ({ userId, joinedAt: at(time) })

describe('nextHost', () => {
    const PEOPLE = [present('phong', '20:10:00'), present('binh', '20:05:00'), present('chi', '20:20:00')]

    it('is the one who joined the session first, of those who may start in the room', () => {
        expect(
            nextHost(
                PEOPLE,
                new Map([
                    ['binh', true],
                    ['phong', true],
                    ['chi', true]
                ])
            )
        ).toBe('binh')
        expect(
            nextHost(
                PEOPLE,
                new Map([
                    ['binh', false],
                    ['phong', false],
                    ['chi', true]
                ])
            )
        ).toBe('chi')
    })

    it('takes the same one on every app for people who joined in the same second', () => {
        const twins = [present('phong', '20:05:00'), present('binh', '20:05:00')]
        expect(
            nextHost(
                twins,
                new Map([
                    ['binh', true],
                    ['phong', true]
                ])
            )
        ).toBe('binh')
    })

    it('is nobody when nobody present may start: the session runs on with no Host', () => {
        expect(
            nextHost(
                PEOPLE,
                new Map([
                    ['binh', false],
                    ['phong', false],
                    ['chi', false]
                ])
            )
        ).toBeNull()
        expect(nextHost([], new Map())).toBeNull()
    })

    it('asks again when someone not asked about comes before anyone who may', () => {
        expect(
            nextHost(
                PEOPLE,
                new Map([
                    ['phong', true],
                    ['chi', true]
                ])
            )
        ).toBeUndefined()
        // One not asked about after the one chosen does not matter.
        expect(nextHost(PEOPLE, new Map([['binh', true]]))).toBe('binh')
    })
})

describe('emptyEndMove', () => {
    const since = at('20:10:00')

    it('ends the session (empty) once the room has been empty 5 minutes since then', () => {
        const move = emptyEndMove(session(since), since, at('20:15:00'), MINUTE)
        expect(move?.clock).toMatchObject({ status: 'ended', endedReason: 'empty', endedAt: at('20:15:00') })
        expect(move?.stretches).toEqual([{ close: at('20:15:00') }])
    })

    it('does nothing before the 5 minutes, nor once someone came in, nor for an older emptiness', () => {
        expect(emptyEndMove(session(since), since, at('20:14:59'), MINUTE)).toBeNull()
        expect(emptyEndMove(session(null), since, at('20:16:00'), MINUTE)).toBeNull()
        expect(emptyEndMove(session(at('20:12:00')), since, at('20:16:00'), MINUTE)).toBeNull()
    })

    it('counts the study minute as set (D-221)', () => {
        expect(dueAt(since, 5, 1000)).toEqual(at('20:10:05'))
        expect(emptyEndMove(session(since), since, at('20:10:05'), 1000)?.clock.status).toBe('ended')
    })
})

describe('selfEndMove', () => {
    it('makes the phase ends it missed first, so the focus phase that began meanwhile is counted', () => {
        // The first focus phase ended at 20:25, the break at 20:30: the second focus phase runs from 20:30.
        const move = selfEndMove(session(), at('20:31:00'), MINUTE, 'study_disabled')
        expect(move?.clock).toMatchObject({ status: 'ended', endedReason: 'study_disabled' })
        expect(move?.stretches).toEqual([
            { close: at('20:25:00') },
            { open: at('20:30:00') },
            { close: at('20:31:00') }
        ])
    })

    it('does nothing to a session ended already', () => {
        const ended: FocusSession = { ...session(), status: 'ended', phaseEndsAt: null, endedAt: at('20:05:00') }
        expect(selfEndMove(ended, at('20:06:00'), MINUTE, 'channel_deleted')).toBeNull()
    })
})

describe('presenceMove', () => {
    const an: Place = { userId: 'an', awaySince: null, countedUntil: at('20:10:00') }
    const binh = present('binh', '20:05:00')
    const MAY = new Map([['binh', true]])

    it('keeps the place and the Host of one whose connection was lost: away from then (D-215)', () => {
        expect(presenceMove(session(), an, 'away', at('20:12:00'), [binh], MAY)).toEqual({
            place: { awaySince: at('20:12:00') },
            hostId: 'an',
            emptySince: null
        })
    })

    it('closes the place of one who left then, and hands the Host over (REQ-STUDY-03)', () => {
        expect(presenceMove(session(), an, 'leave', at('20:12:00'), [binh], MAY)).toEqual({
            place: { leftAt: at('20:12:00') },
            hostId: 'binh',
            emptySince: null
        })
    })

    it('closes one away at the time they went away (D-215)', () => {
        const away = { ...an, awaySince: at('20:11:00') }
        expect(presenceMove(session(), away, 'leave', at('20:14:00'), [binh], MAY)?.place).toEqual({
            leftAt: at('20:11:00')
        })
    })

    it('never goes before what is counted: another app counted a little ahead', () => {
        const ahead = { ...an, countedUntil: at('20:12:01') }
        expect(presenceMove(session(), ahead, 'away', at('20:12:00'), [binh], MAY)?.place).toEqual({
            awaySince: at('20:12:01')
        })
        expect(presenceMove(session(), ahead, 'leave', at('20:12:00'), [binh], MAY)?.place).toEqual({
            leftAt: at('20:12:01')
        })
    })

    it('makes a room empty from then once nobody is present, unless empty already (D-227)', () => {
        expect(presenceMove(session(), an, 'away', at('20:12:00'), [], MAY)?.emptySince).toEqual(at('20:12:00'))
        expect(presenceMove(session(at('20:11:00')), an, 'leave', at('20:12:00'), [], MAY)?.emptySince).toBeNull()
        // A Solo has no room to be empty.
        const solo = { ...session(), kind: 'solo' as const, hostId: null }
        expect(presenceMove(solo, an, 'leave', at('20:12:00'), [], MAY)?.emptySince).toBeNull()
    })

    it('leaves a Host who is not the one leaving alone, and asks about one not known yet', () => {
        const chi: Place = { ...an, userId: 'chi' }
        expect(presenceMove(session(), chi, 'leave', at('20:12:00'), [binh], new Map())?.hostId).toBe('an')
        expect(presenceMove(session(), an, 'leave', at('20:12:00'), [binh], new Map())).toBeUndefined()
    })
})

describe('joinMove', () => {
    it('opens a place for one new, goes on with the one there, back from away (D-215)', () => {
        expect(joinMove(session(), null, null)).toEqual({
            opens: true,
            back: false,
            becomesHost: false,
            endsEmptiness: false
        })
        expect(joinMove(session(), { awaySince: null }, null)).toMatchObject({ opens: false, back: false })
        expect(joinMove(session(), { awaySince: at('20:11:00') }, null)).toMatchObject({ opens: false, back: true })
    })

    it('ends the emptiness of an empty room (D-227)', () => {
        expect(joinMove(session(at('20:11:00')), null, null)).toMatchObject({ endsEmptiness: true })
    })

    it('makes one who may start Host of a room with none, asking only then (REQ-STUDY-03)', () => {
        const hostless = { ...session(), hostId: null }
        expect(joinMove(hostless, null, null)).toBe('ask')
        expect(joinMove(hostless, null, true)).toMatchObject({ becomesHost: true })
        expect(joinMove(hostless, null, false)).toMatchObject({ becomesHost: false })
        expect(joinMove(session(), null, true)).toMatchObject({ becomesHost: false })
    })
})

describe('awayCloseDue', () => {
    it('is due once 3 study minutes have passed (D-215, D-221)', () => {
        expect(awayCloseDue(at('20:10:00'), at('20:12:59'), MINUTE)).toBe(false)
        expect(awayCloseDue(at('20:10:00'), at('20:13:00'), MINUTE)).toBe(true)
        expect(awayCloseDue(at('20:10:00'), at('20:10:03'), 1000)).toBe(true)
    })
})
