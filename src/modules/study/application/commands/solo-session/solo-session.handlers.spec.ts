import { Cycle, FIRST_SOLO_CYCLE } from '../../../domain'
import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { ParticipationOpenedEvent } from '../../events/participation-opened.event'
import { StudyCountedEvent } from '../../events/study-counted.event'
import { MINUTE, NOW, roomSession, soloSession, studyWorld } from '../../study-test-world.shared-spec'
import { EndSignedOutSoloCommand, StartSoloSessionCommand } from './solo-session.commands'
import { EndSignedOutSoloHandler, StartSoloSessionHandler } from './solo-session.handlers'

const FIFTY: Cycle = { focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: null, longBreakEvery: null }
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE)

function setup() {
    const world = studyWorld()
    const starter = new StartSoloSessionHandler(world.repository, world.settings, world.events)
    const ender = new EndSignedOutSoloHandler(world.repository, world.users, world.settings, world.events)
    return {
        world,
        start: (userId: string, cycle: Partial<Cycle> = {}) =>
            starter.execute(new StartSoloSessionCommand(userId, cycle)),
        signOut: (userId: string) => ender.execute(new EndSignedOutSoloCommand(userId))
    }
}

/** What a start that fails says: its error's key and problem. */
const refusal = (started: Promise<unknown>) =>
    started.then(
        () => 'started',
        (error: { errorKey: string; details?: { rule?: string; problem?: string } }) =>
            [error.errorKey, error.details?.rule].filter(Boolean).join(' ')
    )

describe('StartSoloSessionHandler', () => {
    it('runs its first focus phase from now with the cycle sent, and tells its person', async () => {
        const { world, start } = setup()
        const view = await start('binh', FIFTY)
        expect(view).toMatchObject({
            kind: 'solo',
            channelId: null,
            hostId: null,
            focusMinutes: 50,
            status: 'running',
            phase: 'focus',
            phaseEndsAt: later(50),
            stretchStartedAt: NOW,
            serverTime: expect.any(Date)
        })
        const [told, opened] = world.published() as [FocusSessionChangedEvent, ParticipationOpenedEvent]
        expect(told).toMatchObject({ before: null, action: 'start', actorId: 'binh', after: { userId: 'binh' } })
        // Where the Solo counts from, for their minutes today (D-232).
        expect(opened).toEqual(new ParticipationOpenedEvent(['binh']))
    })

    it('starts with the cycle of their last Solo when sent none, 25/5 the first time (D-103)', async () => {
        const { world, start } = setup()
        expect(await start('binh')).toMatchObject(FIRST_SOLO_CYCLE)
        world.put(soloSession({ id: 'old', userId: 'phong', cycle: FIFTY, status: 'ended', startedAt: later(-60) }), [])
        expect(await start('phong')).toMatchObject(FIFTY)
    })

    it('refuses a cycle no study room could have', async () => {
        const { world, start } = setup()
        expect(await refusal(start('binh', { focusMinutes: 50 }))).toBe('VALIDATION_ERROR study_cycle')
        expect(world.published()).toEqual([])
    })

    it('is FOCUS_SESSION_ACTIVE for one taking part in a Room Session, or in a Solo already (REQ-STUDY-05)', async () => {
        const { world, start } = setup()
        world.put(roomSession(), ['an'])
        expect(await refusal(start('an'))).toBe('FOCUS_SESSION_ACTIVE')
        await start('binh')
        expect(await refusal(start('binh'))).toBe('FOCUS_SESSION_ACTIVE')
        expect(world.published()).toHaveLength(2)
    })
})

describe('EndSignedOutSoloHandler', () => {
    it('ends the Solo of one who signed out, counting them, told as ending by itself (D-229)', async () => {
        const { world, signOut } = setup()
        world.put(soloSession(), ['an'])
        world.at(later(12))
        await signOut('an')
        expect(world.sessions.get('solo')).toMatchObject({
            status: 'ended',
            endedReason: 'signed_out',
            endedAt: later(12)
        })
        const published = world.published()
        expect(published.map((event) => event.constructor.name)).toEqual([
            'StudyCountedEvent',
            'FocusSessionChangedEvent'
        ])
        expect((published[0] as StudyCountedEvent).count).toMatchObject({ userId: 'an', timeZone: 'Asia/Ho_Chi_Minh' })
        expect(published[1]).toMatchObject({ action: 'end', actorId: null })
    })

    it('ends a wait already over as expired, at the end of its break (caughtUp)', async () => {
        const { world, signOut } = setup()
        world.put(
            soloSession({
                status: 'waiting',
                phase: 'short_break',
                phaseIndex: 1,
                phaseStartedAt: later(25),
                phaseEndsAt: null,
                waitingUntil: later(40),
                stretchStartedAt: null
            }),
            ['an']
        )
        world.at(later(50))
        await signOut('an')
        expect(world.sessions.get('solo')).toMatchObject({ endedReason: 'expired', endedAt: later(30) })
    })

    it('does nothing for one with no Solo, a Room Session left alone', async () => {
        const { world, signOut } = setup()
        world.put(roomSession(), ['an'])
        await signOut('an')
        expect(world.sessions.get('phien')?.status).toBe('running')
        expect(world.published()).toEqual([])
    })
})
