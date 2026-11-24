import { EventPublisherPort } from '@/modules/realtime'
import { ServerChangedEvent } from '@/modules/servers'
import { FocusSessionChangedEvent } from '@/modules/study'
import { PresenceChosenEvent, StudyActivitySwitchedEvent } from '@/modules/users'
import { VoiceStateChangedEvent } from '@/modules/voice'
import { ActivityLockPort } from '../../ports'
import { socialWorld } from '../../social-test-world.shared-spec'
import { CallChangedEvent } from '../call-changed.event'
import { AnnounceActivityHandler } from './announce-activity.handler'

const JOINED = new Date('2026-11-24T08:00:00Z')

function setUp() {
    const world = socialWorld()
    // An is in the server "ot" and a friend of Dũng.
    world.befriend('an', 'dung')
    const told: string[] = []
    const lines = new Map<string, unknown>()
    /** The lock taken and let go, the line read and sent, in order. */
    const steps: string[] = []
    const record = (to: string, event: string, data: { userId: string; activity: unknown }) => {
        told.push(`${to} ${event} ${data.userId}`)
        lines.set(data.userId, data.activity)
        steps.push(`send ${data.userId}`)
    }
    const lock: ActivityLockPort = {
        whileHeld: async (userIds, work) => {
            steps.push(`lock ${userIds.join(',')}`)
            try {
                return await work()
            } finally {
                steps.push(`unlock ${userIds.join(',')}`)
            }
        }
    }
    const read = world.activities.read.bind(world.activities)
    jest.spyOn(world.activities, 'read').mockImplementation(async (userIds) => {
        steps.push(`read ${userIds.join(',')}`)
        return read(userIds)
    })
    const publisher = {
        toUser: jest.fn((userId: string, event: string, data) => record(`user:${userId}`, event, data)),
        toServer: jest.fn((serverId: string, event: string, data) => record(`server:${serverId}`, event, data))
    } as unknown as EventPublisherPort
    const handler = new AnnounceActivityHandler(
        world.activities,
        publisher,
        world.membership,
        world.relationships,
        world.channels,
        world.voiceRooms,
        lock
    )
    return { world, told, lines, steps, handler }
}

/** A session event about An's Solo, or a room's. */
const sessionChanged = (kind: 'solo' | 'room') =>
    new FocusSessionChangedEvent(
        null,
        { kind, userId: kind === 'solo' ? 'an' : null } as unknown as FocusSessionChangedEvent['after'],
        'start',
        'an',
        null
    )

describe('AnnounceActivityHandler (D-240, D-247)', () => {
    it('tells the line to each server they are in and each friend, as presence goes', async () => {
        const { world, told, lines, handler } = setUp()
        world.inRoom.set('an', 'phong-hoc')

        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'joined', JOINED))

        expect(told).toEqual(['server:ot activity.updated an', 'user:dung activity.updated an'])
        expect(lines.get('an')).toEqual({ room: 'study', solo: null })
    })

    it('reads and sends a line while holding the person’s lock: the last line sent is the one now (L5-e)', async () => {
        const { world, steps, handler } = setUp()
        world.inRoom.set('an', 'phong-hoc')

        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'joined', JOINED))

        expect(steps).toEqual(['lock an', 'read an', 'send an', 'send an', 'unlock an'])
    })

    it('tells null once they leave and study nowhere', async () => {
        const { told, lines, handler } = setUp()

        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'left', JOINED))

        expect(told).toHaveLength(2)
        expect(lines.get('an')).toBeNull()
    })

    it('tells nothing for a microphone or a camera', async () => {
        const { told, handler } = setUp()

        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'updated', JOINED))

        expect(told).toEqual([])
    })

    it('tells a Solo’s every change, never a Room Session’s (its phase is in the room’s own data)', async () => {
        const { world, told, lines, handler } = setUp()
        world.solos.set('an', { status: 'paused', phase: 'focus', phaseEndsAt: null })

        await handler.handle(sessionChanged('room'))
        expect(told).toEqual([])

        await handler.handle(sessionChanged('solo'))
        expect(lines.get('an')).toEqual({ room: null, solo: { status: 'paused', phase: 'focus', phaseEndsAt: null } })
    })

    it('tells null once they choose invisible or turn the switch off, and the line again after', async () => {
        const { world, lines, handler } = setUp()
        world.inRoom.set('an', 'phong-voice')

        world.activitySettings.set('an', { showStudyActivity: true, presence: 'invisible' })
        await handler.handle(new PresenceChosenEvent('an', 'invisible'))
        expect(lines.get('an')).toBeNull()

        world.activitySettings.set('an', { showStudyActivity: false, presence: 'online' })
        await handler.handle(new StudyActivitySwitchedEvent('an', false))
        expect(lines.get('an')).toBeNull()

        world.activitySettings.set('an', { showStudyActivity: true, presence: 'online' })
        await handler.handle(new StudyActivitySwitchedEvent('an', true))
        expect(lines.get('an')).toEqual({ room: 'voice', solo: null })
    })

    it('tells nothing of someone hidden when what they study changes: no beat of null lines (D-79)', async () => {
        const { world, told, handler } = setUp()
        world.activitySettings.set('an', { showStudyActivity: true, presence: 'invisible' })
        world.solos.set('an', { status: 'running', phase: 'focus', phaseEndsAt: new Date('2026-11-24T09:00:00Z') })

        await handler.handle(sessionChanged('solo'))
        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'joined', JOINED))
        world.studyRooms.add('phong-voice')
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'channel', action: 'updated' }], false))
        const call = world.callAs({ callerId: 'an', calleeId: 'dung', dmChannelId: 'dm-an-dung', status: 'active' })
        await handler.handle(new CallChangedEvent((await world.calls.find(call.id))!, 'ringing'))

        expect(told.filter((line) => line.endsWith(' an'))).toEqual([])
    })

    it('tells nothing of someone in a call when their Solo changes, the call itself told (spec 09 rule 7)', async () => {
        const { world, told, handler } = setUp()
        world.solos.set('an', { status: 'paused', phase: 'focus', phaseEndsAt: null })
        world.callAs({ callerId: 'an', calleeId: 'binh', dmChannelId: 'dm-an-binh', status: 'active' })

        await handler.handle(sessionChanged('solo'))

        expect(told).toEqual([])
    })

    it('tells both of a call when it becomes active and when it stops being, nothing else (spec 09 rule 7)', async () => {
        const { world, told, lines, handler } = setUp()
        world.solos.set('an', { status: 'paused', phase: 'focus', phaseEndsAt: null })
        const ringing = world.callAs({ callerId: 'an', calleeId: 'binh', dmChannelId: 'dm-an-binh' })
        const call = async () => (await world.calls.find(ringing.id))!

        await handler.handle(new CallChangedEvent(await call(), null))
        expect(told).toEqual([])

        world.callRows.set(ringing.id, { ...ringing, status: 'active' })
        await handler.handle(new CallChangedEvent(await call(), 'ringing'))
        expect(told.filter((line) => line.endsWith(' an'))).toHaveLength(2)
        expect(told.filter((line) => line.endsWith(' binh'))).toEqual([
            'server:ot activity.updated binh',
            'server:nd activity.updated binh'
        ])
        expect(lines.get('an')).toBeNull()

        told.length = 0
        world.callRows.set(ringing.id, { ...ringing, status: 'ended' })
        await handler.handle(new CallChangedEvent(await call(), 'active'))
        expect(lines.get('an')).toEqual({ room: null, solo: { status: 'paused', phase: 'focus', phaseEndsAt: null } })
    })

    it('tells everyone in the server’s voice rooms when its channels changed (a study room turned on or off)', async () => {
        const { world, told, lines, handler } = setUp()
        world.inRoom.set('an', 'phong-voice')
        world.inRoom.set('chi', 'phong-nd')

        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'channel', action: 'created' }], true))
        expect(told).toEqual([])

        world.studyRooms.add('phong-voice')
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'channel', action: 'updated' }], false))
        expect(told).toEqual(['server:ot activity.updated an', 'user:dung activity.updated an'])
        expect(lines.get('an')).toEqual({ room: 'study', solo: null })
    })

    it('logs a failure and throws nothing', async () => {
        const { world, handler } = setUp()
        jest.mocked(world.voiceRooms.roomsOf).mockRejectedValueOnce(new Error('database down'))
        const logged = jest.spyOn(handler['logger'], 'error').mockImplementation()

        await expect(
            handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'joined', JOINED))
        ).resolves.toBeUndefined()
        expect(logged).toHaveBeenCalled()
    })
})
