import { Call, CallNotFoundError, CallPresence } from '../../../domain'
import { CallChangedEvent } from '../../events/call-changed.event'
import { socialWorld } from '../../social-test-world.shared-spec'
import { CheckCallMediaCommand, EndActiveCallCommand, JoinCallCommand } from './call-media.commands'
import { CheckCallMediaHandler, EndActiveCallHandler, JoinCallHandler } from './call-media.handlers'

const acceptedAt = new Date('2026-11-24T21:44:06Z')
const at = (seconds: number) => new Date(acceptedAt.getTime() + seconds * 1000)

async function setUp() {
    const world = socialWorld()
    const deps = [world.calls, world.callJobs, world.callMedia, world.eventBus] as const
    const handlers = {
        join: new JoinCallHandler(...deps),
        check: new CheckCallMediaHandler(...deps),
        endActive: new EndActiveCallHandler(...deps)
    }
    const anBinh = (await world.dms.open('an', 'binh')).channelId
    const call = (changes: Partial<Call> = {}) =>
        world.callAs({
            callerId: 'an',
            calleeId: 'binh',
            dmChannelId: anBinh,
            status: 'active',
            version: 1,
            createdAt: at(-10),
            acceptedAt,
            ...changes
        })
    const inRoom = (callId: string, userId: string, changes: Partial<CallPresence> = {}) => {
        const rows = world.callPresence.get(callId) ?? []
        rows.push({
            userId,
            participantSid: `PA_${userId}`,
            joinedAt: at(2),
            leftAt: null,
            sessionId: `session-${userId}`,
            ...changes
        })
        world.callPresence.set(callId, rows)
    }
    const told = () => world.published(CallChangedEvent).map(({ call: one }) => `${one.id} ${one.status}`)
    return { world, handlers, anBinh, call, inRoom, told }
}

describe('JoinCallHandler (D-239, D-246)', () => {
    it('gives one of an active call a token to its room, with their sign-in session', async () => {
        const { world, handlers, call } = await setUp()
        const { id } = call()

        await expect(handlers.join.execute(new JoinCallCommand('binh', id, 'session-binh'))).resolves.toEqual({
            token: `token-${id}-binh`,
            url: 'ws://livekit.test'
        })
        expect(world.callMedia.joinToken).toHaveBeenCalledWith(id, 'binh', 'session-binh')
    })

    it.each<[string, Partial<Call>]>([
        ['still ringing', { status: 'ringing', acceptedAt: null }],
        ['over', { status: 'ended', endedAt: at(60) }]
    ])('gives no token for a call %s: the route answers the call as it is', async (_, changes) => {
        const { world, handlers, call } = await setUp()
        const { id } = call(changes)

        await expect(handlers.join.execute(new JoinCallCommand('an', id, 'session-an'))).resolves.toBeNull()
        expect(world.callMedia.joinToken).not.toHaveBeenCalled()
    })

    it('finds no call for someone not of it, the same as none (NFR-SEC-05)', async () => {
        const { handlers, call } = await setUp()
        const { id } = call()

        await expect(handlers.join.execute(new JoinCallCommand('chi', id, 's'))).rejects.toThrow(CallNotFoundError)
        await expect(handlers.join.execute(new JoinCallCommand('an', 'call-none', 's'))).rejects.toThrow(
            CallNotFoundError
        )
    })
})

describe('CheckCallMediaHandler (REQ-SOCIAL-05, D-120, D-242)', () => {
    beforeEach(() => jest.useFakeTimers({ now: at(100), doNotFake: ['nextTick', 'setImmediate'] }))
    afterEach(() => jest.useRealTimers())

    it('fails a call nobody connected to 15 seconds after answering: no length', async () => {
        const { world, handlers, call, inRoom, told } = await setUp()
        const { id } = call()
        inRoom(id, 'an')

        await expect(handlers.check.execute(new CheckCallMediaCommand(id, 1))).resolves.toBe(true)

        expect(world.callRows.get(id)).toMatchObject({ status: 'failed', endReason: null, endedAt: at(15) })
        expect(told()).toEqual([`${id} failed`])
    })

    it('ends a call 30 seconds after one of the two left, at the time they left', async () => {
        const { world, handlers, call, inRoom } = await setUp()
        const { id } = call()
        inRoom(id, 'an')
        inRoom(id, 'binh', { leftAt: at(50) })

        await expect(handlers.check.execute(new CheckCallMediaCommand(id, 1))).resolves.toBe(true)

        expect(world.callRows.get(id)).toMatchObject({ status: 'ended', endedAt: at(50) })
    })

    it('does nothing for a job of a version gone by (someone came back since), or a call over', async () => {
        const { world, handlers, call, inRoom } = await setUp()
        const { id } = call({ version: 2 })
        inRoom(id, 'an')
        const over = call({ status: 'ended', endedAt: at(9) })

        await expect(handlers.check.execute(new CheckCallMediaCommand(id, 1))).resolves.toBe(false)
        await expect(handlers.check.execute(new CheckCallMediaCommand(over.id, 1))).resolves.toBe(false)
        await expect(handlers.check.execute(new CheckCallMediaCommand('call-none', 1))).resolves.toBe(false)
        expect(world.callRows.get(id)!.status).toBe('active')
    })

    it('does nothing while both are in', async () => {
        const { world, handlers, call, inRoom } = await setUp()
        const { id } = call()
        inRoom(id, 'an')
        inRoom(id, 'binh')

        await expect(handlers.check.execute(new CheckCallMediaCommand(id, 1))).resolves.toBe(false)
        expect(world.callRows.get(id)!.status).toBe('active')
    })
})

describe('EndActiveCallHandler (D-242, D-246: joining a voice room)', () => {
    it('ends the active call of someone joining a voice room, as if they hung up', async () => {
        const { world, handlers, call, told } = await setUp()
        const { id } = call()

        await handlers.endActive.execute(new EndActiveCallCommand('binh'))

        expect(world.callRows.get(id)).toMatchObject({ status: 'ended', endedAt: expect.any(Date) })
        expect(told()).toEqual([`${id} ended`])
    })

    it('leaves a call still ringing, and someone in no call', async () => {
        const { world, handlers, call } = await setUp()
        const { id } = call({ status: 'ringing', acceptedAt: null })

        await handlers.endActive.execute(new EndActiveCallCommand('an'))
        await handlers.endActive.execute(new EndActiveCallCommand('binh'))
        await handlers.endActive.execute(new EndActiveCallCommand('chi'))

        expect(world.callRows.get(id)!.status).toBe('ringing')
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})
