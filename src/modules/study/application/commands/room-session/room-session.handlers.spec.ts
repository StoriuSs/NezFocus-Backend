import { Cycle } from '../../../domain'
import { FocusSessionChangedEvent } from '../../events/focus-session-changed.event'
import { ParticipationOpenedEvent } from '../../events/participation-opened.event'
import { MINUTE, NOW, roomSession, soloSession, studyWorld } from '../../study-test-world.shared-spec'
import { EndGoneRoomSessionsCommand, StartRoomSessionCommand } from './room-session.commands'
import { EndGoneRoomSessionsHandler, StartRoomSessionHandler } from './room-session.handlers'

const FIFTY: Cycle = { focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: null, longBreakEvery: null }

function setup() {
    const world = studyWorld()
    const handler = new StartRoomSessionHandler(
        world.repository,
        world.channels,
        world.checker,
        world.voiceRooms,
        world.users,
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
        const [event, opened] = world.published() as [FocusSessionChangedEvent, ParticipationOpenedEvent]
        expect(event).toBeInstanceOf(FocusSessionChangedEvent)
        expect(event).toMatchObject({ before: null, action: 'start', actorId: 'an' })
        // Everyone present hears where they count from (D-232).
        expect(opened).toEqual(new ParticipationOpenedEvent(['an', 'binh', 'phong']))
    })

    it('ends the Solo of one in the room as the session starts, telling them first, counted in their zone (D-103)', async () => {
        const { world, start } = setup()
        world.put(soloSession({ userId: 'binh' }), ['binh'])
        await start('an', 'phong-hoc')
        expect(world.sessions.get('solo')).toMatchObject({ status: 'ended', endedReason: 'joined_room' })
        expect(world.participants.get('phien-2')).toContain('binh')
        const published = world.published()
        expect(published.map((event) => event.constructor.name)).toEqual([
            'StudyCountedEvent',
            'FocusSessionChangedEvent',
            'FocusSessionChangedEvent',
            'ParticipationOpenedEvent'
        ])
        expect(published[1]).toMatchObject({ action: 'end', actorId: null, after: { kind: 'solo', userId: 'binh' } })
        expect(published[2]).toMatchObject({ action: 'start', actorId: 'an' })
        expect(world.repository.startInRoom).toHaveBeenCalledWith(
            expect.anything(),
            expect.any(Function),
            expect.any(Function)
        )
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
        // In the room when their zones are read, gone when the start reads the room under its lock.
        const peopleIn = world.voiceRooms.peopleIn as jest.Mock
        peopleIn.mockImplementationOnce(peopleIn.getMockImplementation()!).mockResolvedValueOnce([])
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

describe('EndGoneRoomSessionsHandler', () => {
    const setupEnd = () => {
        const world = studyWorld()
        const handler = new EndGoneRoomSessionsHandler(
            world.repository,
            world.channels,
            world.users,
            world.settings,
            world.events
        )
        return { world, end: () => handler.execute(new EndGoneRoomSessionsCommand('ot')) }
    }

    it('ends the session of a room turned off (study_disabled) or deleted (channel_deleted), told as ending by itself', async () => {
        const { world, end } = setupEnd()
        world.put(roomSession({ id: 'tat', channelId: 'tan-gau' }))
        world.put(roomSession({ id: 'xoa', channelId: 'da-xoa' }))
        world.put(roomSession({ id: 'van-hoc' }))
        expect(await end()).toBe(2)
        expect(world.sessions.get('tat')).toMatchObject({ status: 'ended', endedReason: 'study_disabled' })
        expect(world.sessions.get('xoa')).toMatchObject({ status: 'ended', endedReason: 'channel_deleted' })
        expect(world.sessions.get('van-hoc')).toMatchObject({ status: 'running' })
        const ends = world.published().filter((event) => event instanceof FocusSessionChangedEvent)
        expect(ends).toEqual([
            expect.objectContaining({ action: 'end', actorId: null }),
            expect.objectContaining({ action: 'end', actorId: null })
        ])
    })

    it('goes on past a session whose end fails', async () => {
        const { world, end } = setupEnd()
        world.put(roomSession({ id: 'hong', channelId: 'tan-gau' }))
        world.put(roomSession({ id: 'tot', channelId: 'da-xoa' }))
        ;(world.repository.change as jest.Mock).mockRejectedValueOnce(new Error('database down'))
        expect(await end()).toBe(1)
        expect(world.sessions.get('tot')).toMatchObject({ status: 'ended' })
    })
})
