import { CallMediaChangedEvent } from '@/modules/voice'
import { Call } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { RecordCallMediaHandler } from './record-call-media.handler'

const acceptedAt = new Date('2026-11-24T21:44:06Z')
const at = (seconds: number) => new Date(acceptedAt.getTime() + seconds * 1000)

function setUp(changes: Partial<Call> = {}) {
    const world = socialWorld()
    const handler = new RecordCallMediaHandler(world.calls, world.callJobs, world.callMedia, world.eventBus)
    const call = world.callAs({
        callerId: 'an',
        calleeId: 'binh',
        dmChannelId: 'dm-an-binh',
        status: 'active',
        version: 1,
        acceptedAt,
        ...changes
    })
    const joins = (userId: string, sid = `PA_${userId}`, joinedAt = at(2)) =>
        handler.handle(
            new CallMediaChangedEvent(call.id, {
                kind: 'joined',
                userId,
                participantSid: sid,
                joinedAt,
                sessionId: `session-${userId}`
            })
        )
    const leaves = (userId: string, sid = `PA_${userId}`, leftAt = at(40)) =>
        handler.handle(new CallMediaChangedEvent(call.id, { kind: 'left', userId, participantSid: sid, at: leftAt }))
    return { world, call, joins, leaves }
}

describe('RecordCallMediaHandler (D-239, D-242)', () => {
    it('writes a party coming in, the call a version on, and its 15 seconds set again', async () => {
        const { world, call, joins } = setUp()

        await joins('an')

        expect(world.callPresence.get(call.id)).toEqual([
            { userId: 'an', participantSid: 'PA_an', joinedAt: at(2), leftAt: null, sessionId: 'session-an' }
        ])
        expect(world.callRows.get(call.id)!.version).toBe(2)
        expect(world.callJobs.dropMediaCheck).toHaveBeenCalledWith(call.id, 1)
        expect(world.callJobs.checkMediaAt).toHaveBeenCalledWith(call.id, 2, at(15))
    })

    it('sets no deadline once both are in; one leaving gives 30 seconds from then', async () => {
        const { world, call, joins, leaves } = setUp()
        await joins('an')
        await joins('binh')
        expect(world.callJobs.checkMediaAt).toHaveBeenCalledTimes(1)

        await leaves('binh')

        expect(world.callJobs.checkMediaAt).toHaveBeenLastCalledWith(call.id, 4, at(70))
    })

    it('puts out someone not of the call, and anyone joining a call over', async () => {
        const { world, call, joins } = setUp({ status: 'ended', endedAt: at(9) })

        await joins('an')

        expect(world.callMedia.removeConnection).toHaveBeenCalledWith(call.id, 'an', 'PA_an')
        expect(world.callPresence.get(call.id)).toBeUndefined()
        expect(world.callJobs.checkMediaAt).not.toHaveBeenCalled()
    })

    it('keeps a failure to itself: the sweep reads the room again', async () => {
        const { world, joins } = setUp()
        world.calls.recordMedia.mockRejectedValueOnce(new Error('database down'))

        await expect(joins('an')).resolves.toBeUndefined()
    })

    it('writes the row when the media job cannot be set (Redis down): the sweep runs the deadline', async () => {
        const { world, call, joins } = setUp()
        world.callJobs.checkMediaAt.mockRejectedValueOnce(new Error('redis down'))

        await joins('an')

        expect(world.callPresence.get(call.id)).toHaveLength(1)
    })
})
