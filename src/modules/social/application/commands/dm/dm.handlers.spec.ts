import { CannotMessageUserError, DmNotFoundError, PersonNotFoundError } from '../../../domain'
import { DmChangedEvent } from '../../events/dm-changed.event'
import { socialWorld } from '../../social-test-world.shared-spec'
import { CloseDmCommand, OpenDmCommand } from './dm.commands'
import { CloseDmHandler, OpenDmHandler } from './dm.handlers'

function setUp() {
    const world = socialWorld()
    const opener = new OpenDmHandler(world.dms, world.relationships, world.membership, world.users, world.eventBus)
    const closer = new CloseDmHandler(world.dms, world.eventBus)
    return {
        world,
        open: (userId: string, otherId: string) => opener.execute(new OpenDmCommand(userId, otherId)),
        close: (userId: string, channelId: string) => closer.execute(new CloseDmCommand(userId, channelId))
    }
}

describe('OpenDmHandler (REQ-SOCIAL-04, D-242, D-244)', () => {
    it('makes a DM with someone in a shared server, open for the opener and shown to the other with its first message', async () => {
        const { world, open } = setUp()

        const { channelId } = await open('an', 'binh')

        const row = world.dmRows.get(channelId)!
        expect(row).toMatchObject({ low: 'an', high: 'binh', lowClosedAt: null })
        expect(row.highClosedAt).toEqual(row.createdAt)
        expect(world.published(DmChangedEvent)).toEqual([new DmChangedEvent('an', channelId, 'created', 'binh')])
    })

    it('makes one with a friend who shares no server', async () => {
        const { world, open } = setUp()
        world.befriend('an', 'dung')

        await expect(open('an', 'dung')).resolves.toEqual({ channelId: 'dm-an-dung' })
    })

    it('answers the DM there is, either way round, telling no one when nothing changed', async () => {
        const { world, open } = setUp()
        const { channelId } = await open('an', 'binh')
        world.eventBus.publish.mockClear()

        await expect(open('an', 'binh')).resolves.toEqual({ channelId })
        expect(world.published(DmChangedEvent)).toEqual([])
        expect(world.dmRows.size).toBe(1)
    })

    it('opens it again on the side that closed it, and says so', async () => {
        const { world, open, close } = setUp()
        const { channelId } = await open('an', 'binh')
        await close('an', channelId)
        world.eventBus.publish.mockClear()

        await open('an', 'binh')

        expect(world.dmRows.get(channelId)!.lowClosedAt).toBeNull()
        expect(world.published(DmChangedEvent)).toEqual([new DmChangedEvent('an', channelId, 'reopened', 'binh')])
    })

    it('opens for the other one too, from their side: their own close mark goes', async () => {
        const { world, open } = setUp()
        const { channelId } = await open('an', 'binh')

        await open('binh', 'an')

        expect(world.dmRows.get(channelId)!.highClosedAt).toBeNull()
    })

    describe('the one answer for every reason one may not message someone (REQ-SOCIAL-04)', () => {
        it.each<[string, (world: ReturnType<typeof socialWorld>) => void, string, string]>([
            ['a stranger: no friendship, no server shared', () => undefined, 'an', 'chi'],
            [
                'someone in a shared server who lets no server member write',
                (w) => w.allowing.delete('binh'),
                'an',
                'binh'
            ],
            ['someone I blocked', (w) => w.block('an', 'binh'), 'an', 'binh'],
            ['someone who blocked me, though we share a server', (w) => w.block('binh', 'an'), 'an', 'binh'],
            [
                'a friend who blocked me',
                (w) => {
                    w.befriend('an', 'dung')
                    w.block('dung', 'an')
                },
                'an',
                'dung'
            ]
        ])('%s', async (_, arrange, userId, otherId) => {
            const { world, open } = setUp()
            arrange(world)

            const refusal = await open(userId, otherId).catch((error: unknown) => error)

            expect(refusal).toBeInstanceOf(CannotMessageUserError)
            expect((refusal as CannotMessageUserError).errorKey).toBe('CANNOT_MESSAGE_USER')
            expect(world.dmRows.size).toBe(0)
            expect(world.published(DmChangedEvent)).toEqual([])
        })
    })

    it.each([
        ['oneself', 'an'],
        ['no such account', 'nobody'],
        ['an account waiting to be deleted (D-182)', 'giang'],
        ['an account deleted for good', 'ha'],
        ['an account not completed', 'khoa']
    ])('answers not found for %s, making nothing', async (_, otherId) => {
        const { world, open } = setUp()

        await expect(open('an', otherId)).rejects.toBeInstanceOf(PersonNotFoundError)
        expect(world.dmRows.size).toBe(0)
    })

    it('answers a DM there is though they may no longer message each other: its history is still theirs', async () => {
        const { world, open, close } = setUp()
        const { channelId } = await open('an', 'binh')
        await close('an', channelId)
        world.block('binh', 'an')

        await expect(open('an', 'binh')).resolves.toEqual({ channelId })
        expect(world.dmRows.get(channelId)!.lowClosedAt).toBeNull()
    })

    it('answers a DM there is with an account since waiting to be deleted (spec 09 `deleted-account`)', async () => {
        const { world, open } = setUp()
        world.befriend('an', 'dung')
        const { channelId } = await open('an', 'dung')
        world.people.set('dung', {
            ...world.people.get('dung')!,
            deletionRequestedAt: new Date('2026-11-24T00:00:00Z')
        })

        await expect(open('an', 'dung')).resolves.toEqual({ channelId })
    })
})

describe('CloseDmHandler (D-244)', () => {
    it('closes it on my side only, and says so', async () => {
        const { world, open, close } = setUp()
        const { channelId } = await open('an', 'binh')
        await open('binh', 'an')
        world.eventBus.publish.mockClear()

        await close('an', channelId)

        expect(world.dmRows.get(channelId)).toMatchObject({ highClosedAt: null })
        expect(world.dmRows.get(channelId)!.lowClosedAt).not.toBeNull()
        expect(world.published(DmChangedEvent)).toEqual([new DmChangedEvent('an', channelId, 'closed', 'binh')])
    })

    it('keeps the first mark when closed again, telling no one', async () => {
        const { world, open, close } = setUp()
        const { channelId } = await open('an', 'binh')
        await close('an', channelId)
        const mark = world.dmRows.get(channelId)!.lowClosedAt
        world.eventBus.publish.mockClear()

        await close('an', channelId)

        expect(world.dmRows.get(channelId)!.lowClosedAt).toEqual(mark)
        expect(world.published(DmChangedEvent)).toEqual([])
    })

    it('answers not found for someone else’s DM, or none', async () => {
        const { open, close } = setUp()
        const { channelId } = await open('an', 'binh')

        await expect(close('chi', channelId)).rejects.toBeInstanceOf(DmNotFoundError)
        await expect(close('an', 'dm-khong-co')).rejects.toBeInstanceOf(DmNotFoundError)
    })
})
