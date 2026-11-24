import { DmRoomsPort, EventPublisherPort } from '@/modules/realtime'
import { DmChangedEvent } from '../dm-changed.event'
import { socialWorld } from '../../social-test-world.shared-spec'
import { PublishDmChangeHandler } from './publish-dm-change.handler'

async function setUp() {
    const world = socialWorld()
    const told: { userId: string; event: string; data: Record<string, unknown> }[] = []
    const publisher = {
        toUser: jest.fn((userId: string, event: string, data: Record<string, unknown>) =>
            told.push({ userId, event, data })
        )
    } as unknown as EventPublisherPort
    const rooms: DmRoomsPort & { join: jest.Mock } = { join: jest.fn(async () => undefined) }
    const handler = new PublishDmChangeHandler(
        publisher,
        rooms,
        world.dms,
        world.relationships,
        world.membership,
        world.users,
        world.presence,
        world.lastMessages
    )
    const { channelId } = await world.dms.open('an', 'binh')
    return { world, told, rooms, handler, channelId }
}

describe('PublishDmChangeHandler (SRS 5.2, D-242, D-244)', () => {
    it('puts both of a new DM in its room, then tells only its maker', async () => {
        const { told, rooms, handler, channelId } = await setUp()

        await handler.handle(new DmChangedEvent('an', channelId, 'created', 'binh'))

        expect(rooms.join).toHaveBeenCalledWith(channelId, ['an', 'binh'])
        expect(told).toEqual([
            {
                userId: 'an',
                event: 'dm.created',
                data: { dm: expect.objectContaining({ id: channelId, user: expect.objectContaining({ id: 'binh' }) }) }
            }
        ])
    })

    it('tells the tabs of the one who opened it again or closed it whether it is in their list now', async () => {
        const { world, told, rooms, handler, channelId } = await setUp()

        await handler.handle(new DmChangedEvent('an', channelId, 'reopened', 'binh'))
        await world.dms.close('an', channelId)
        await handler.handle(new DmChangedEvent('an', channelId, 'closed', 'binh'))

        expect(rooms.join).not.toHaveBeenCalled()
        expect(told.map(({ userId, event, data }) => [userId, event, data.shown])).toEqual([
            ['an', 'dm.updated', true],
            ['an', 'dm.updated', false]
        ])
    })

    it('says whether it is shown as the row stands, whichever event comes last (two tabs at once)', async () => {
        const { world, told, handler, channelId } = await setUp()
        await world.dms.close('an', channelId)

        // The opening's event told after the close it raced with.
        await handler.handle(new DmChangedEvent('an', channelId, 'reopened', 'binh'))

        expect(told.map(({ data }) => data.shown)).toEqual([false])
    })

    it('keeps a failure to itself: the list is read again on the next opening of the app', async () => {
        const { rooms, handler, channelId } = await setUp()
        rooms.join.mockRejectedValueOnce(new Error('Redis down'))

        await expect(handler.handle(new DmChangedEvent('an', channelId, 'created', 'binh'))).resolves.toBeUndefined()
    })
})
