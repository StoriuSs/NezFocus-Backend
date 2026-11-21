import { Cycle } from '../../../domain'
import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { MINUTE, NOW, roomSession, studyWorld } from '../../study-test-world.shared-spec'
import { StartRoomSessionCommand } from './room-session.commands'
import { StartRoomSessionHandler } from './room-session.handlers'

const FIFTY: Cycle = { focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: null, longBreakEvery: null }

function setup() {
    const world = studyWorld()
    const handler = new StartRoomSessionHandler(
        world.repository,
        world.channels,
        world.checker,
        world.voiceRooms,
        world.settings,
        world.events
    )
    const start = (userId: string, channelId: string, cycle: Partial<Cycle> = {}) =>
        handler.execute(new StartRoomSessionCommand(userId, channelId, cycle))
    return { world, start }
}

/** What a start that fails says: its error's key and reason. */
const refusal = (started: Promise<unknown>) =>
    started.then(
        () => 'started',
        (error: { errorKey: string; details?: { reason?: string; rule?: string; problem?: string } }) =>
            [error.errorKey, error.details?.reason ?? error.details?.problem].filter(Boolean).join(' ')
    )

describe('StartRoomSessionHandler', () => {
    it('makes An Host of a session with everyone in the room, the room’s cycle, and tells it', async () => {
        const { world, start } = setup()
        const view = await start('an', 'phong-hoc')
        expect(view).toMatchObject({
            kind: 'room',
            channelId: 'phong-hoc',
            hostId: 'an',
            focusMinutes: 25,
            status: 'running',
            phase: 'focus',
            version: 0,
            phaseEndsAt: new Date(NOW.getTime() + 25 * MINUTE)
        })
        expect(view.serverTime).toBeInstanceOf(Date)
        expect(world.participants.get(view.id)).toEqual(['an', 'binh', 'phong'])
        const [event] = world.published() as FocusSessionChangedEvent[]
        expect(event).toBeInstanceOf(FocusSessionChangedEvent)
        expect(event).toMatchObject({ before: null, action: 'start', actorId: 'an' })
    })

    it('takes the cycle sent, and refuses half a long break', async () => {
        const { start } = setup()
        expect((await start('an', 'phong-hoc', FIFTY)).focusMinutes).toBe(50)
        const { start: again } = setup()
        expect(await refusal(again('an', 'phong-hoc', { ...FIFTY, longBreakMinutes: 20 }))).toBe(
            'VALIDATION_ERROR long_break_pair'
        )
        // Focus and short break go together.
        expect(await refusal(again('an', 'phong-hoc', { focusMinutes: 50 }))).toBe(
            'VALIDATION_ERROR short_break_minutes'
        )
        expect(await refusal(again('an', 'phong-hoc', { shortBreakMinutes: 10 }))).toBe(
            'VALIDATION_ERROR focus_minutes'
        )
    })

    it('says why not: no study room, not in it, only managers start here, timed out', async () => {
        const { world, start } = setup()
        world.inRoom.set('binh', 'tan-gau')
        expect(await refusal(start('binh', 'tan-gau'))).toBe('FORBIDDEN not_study_room')
        expect(await refusal(start('binh', 'phong-thi'))).toBe('FORBIDDEN cannot_start')
        expect(await refusal(start('an', 'phong-thi'))).toBe('FORBIDDEN not_in_room')
        expect(await refusal(start('dung', 'phong-hoc'))).toBe('MEMBER_TIMED_OUT')
        expect(await refusal(start('chi', 'phong-thi'))).toBe('started')
    })

    it('answers NOT_FOUND for a room one may not see, a text channel, no room, or not a member', async () => {
        const { start } = setup()
        for (const [userId, channelId] of [
            ['binh', 'bi-mat'],
            ['an', 'hoi-dap'],
            ['an', 'khong-co'],
            ['khach', 'phong-hoc']
        ]) {
            expect(await refusal(start(userId, channelId))).toBe('NOT_FOUND')
        }
    })

    it('starts nothing for one who left the room between the check and the start', async () => {
        const { world, start } = setup()
        ;(world.voiceRooms.peopleIn as jest.Mock).mockResolvedValueOnce([])
        expect(await refusal(start('an', 'phong-hoc'))).toBe('FORBIDDEN not_in_room')
        expect(world.published()).toEqual([])
    })

    it('is FOCUS_SESSION_ACTIVE in a room that has a session, and tells nothing', async () => {
        const { world, start } = setup()
        world.put(roomSession())
        expect(await refusal(start('an', 'phong-hoc'))).toBe('FOCUS_SESSION_ACTIVE')
        expect(world.published()).toEqual([])
    })
})
