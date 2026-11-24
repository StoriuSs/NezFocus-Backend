import { socialWorld } from '../../social-test-world.shared-spec'
import {
    CanMessageInDmQuery,
    GetDmConversationQuery,
    GetDmQuery,
    ListDmChannelIdsQuery,
    ListMyDmsQuery,
    ListShownDmsQuery
} from './dm.queries'
import {
    CanMessageInDmHandler,
    GetDmConversationHandler,
    GetDmHandler,
    ListDmChannelIdsHandler,
    ListMyDmsHandler,
    ListShownDmsHandler
} from './dm.handlers'

/** An's DMs with Bình (a shared server, online) and Dũng (a friend, no server shared). */
async function setUp() {
    const world = socialWorld()
    world.befriend('an', 'dung')
    const viewDeps = [
        world.dms,
        world.relationships,
        world.membership,
        world.users,
        world.presence,
        world.lastMessages,
        world.activities
    ] as const
    const reach = [world.dms, world.relationships, world.membership, world.users] as const
    const handlers = {
        list: new ListMyDmsHandler(...viewDeps),
        get: new GetDmHandler(...viewDeps),
        conversation: new GetDmConversationHandler(world.dms),
        canMessage: new CanMessageInDmHandler(...reach),
        shown: new ListShownDmsHandler(world.dms, world.lastMessages),
        channelIds: new ListDmChannelIdsHandler(world.dms)
    }
    // As OpenDmHandler leaves them: open on An's side, shown to the other with a first message.
    await world.dms.open('an', 'binh')
    await world.dms.open('an', 'dung')
    return {
        world,
        list: (userId: string) => handlers.list.execute(new ListMyDmsQuery(userId)),
        get: (userId: string, channelId: string) => handlers.get.execute(new GetDmQuery(userId, channelId)),
        conversation: (channelId: string) => handlers.conversation.execute(new GetDmConversationQuery(channelId)),
        canMessage: (userId: string, channelId: string) =>
            handlers.canMessage.execute(new CanMessageInDmQuery(userId, channelId)),
        shown: (userId: string) => handlers.shown.execute(new ListShownDmsQuery(userId)),
        channelIds: (userId: string) => handlers.channelIds.execute(new ListDmChannelIdsQuery(userId))
    }
}

describe('ListMyDmsHandler (REQ-SOCIAL-04, D-244)', () => {
    it('lists my DMs the latest active first, with whom, presence, whether I may write, the last message', async () => {
        const { world, list } = await setUp()
        world.say('dm-an-dung', 'dung', 'Mai học nhóm nha')

        const dms = await list('an')

        expect(dms.map((dm) => dm.id)).toEqual(['dm-an-dung', 'dm-an-binh'])
        expect(dms[0]).toMatchObject({
            user: { id: 'dung', username: 'dung', avatarUrl: 'https://cdn/dung.png' },
            presence: 'offline',
            canMessage: true,
            lastMessage: { authorId: 'dung', content: 'Mai học nhóm nha' }
        })
        expect(dms[1]).toMatchObject({ user: { id: 'binh' }, presence: 'online', canMessage: true, lastMessage: null })
        // One read of last messages for the whole list.
        expect(world.lastMessages.lastMessagesOf).toHaveBeenCalledTimes(1)
    })

    it('leaves out a DM the other one made until its first message, then shows it (D-244)', async () => {
        const { world, list } = await setUp()

        expect(await list('binh')).toEqual([])
        world.say('dm-an-binh', 'an')
        expect((await list('binh')).map((dm) => dm.id)).toEqual(['dm-an-binh'])
    })

    it('leaves out a DM I closed until a message comes after', async () => {
        const { world, list } = await setUp()
        world.say('dm-an-binh', 'binh')
        await world.dms.close('an', 'dm-an-binh')

        expect((await list('an')).map((dm) => dm.id)).toEqual(['dm-an-dung'])
        world.say('dm-an-binh', 'binh')
        expect((await list('an')).map((dm) => dm.id)).toContain('dm-an-binh')
    })

    it('hides presence and says I may not write once nothing lets me: no friendship, no server shared', async () => {
        const { world, list } = await setUp()
        world.shared.clear()

        const binh = (await list('an')).find((dm) => dm.id === 'dm-an-binh')!

        expect(binh).toMatchObject({ presence: null, canMessage: false })
    })

    it('gives the other one’s study activity where their presence is given, none once nothing links us (D-247)', async () => {
        const { world, list } = await setUp()
        world.inRoom.set('binh', 'phong-voice')
        world.inRoom.set('dung', 'phong-hoc')

        const before = await list('an')
        expect(before.find((dm) => dm.id === 'dm-an-binh')).toMatchObject({ activity: { room: 'voice', solo: null } })
        expect(before.find((dm) => dm.id === 'dm-an-dung')).toMatchObject({ activity: { room: 'study', solo: null } })

        world.shared.clear()
        const binh = (await list('an')).find((dm) => dm.id === 'dm-an-binh')!
        expect(binh).toMatchObject({ presence: null, activity: null })
    })

    it('shows an account since waiting to be deleted as deleted, with no presence, not to be written to (D-182)', async () => {
        const { world, list } = await setUp()
        world.people.set('dung', {
            ...world.people.get('dung')!,
            deletionRequestedAt: new Date('2026-11-24T00:00:00Z')
        })

        const dung = (await list('an')).find((dm) => dm.id === 'dm-an-dung')!

        expect(dung).toMatchObject({
            user: { id: 'dung', username: null, displayName: null, avatarUrl: null },
            presence: null,
            canMessage: false
        })
    })
})

describe('GetDmHandler (D-159)', () => {
    it('gives one DM of mine, shown or not, and nothing for someone else', async () => {
        const { get } = await setUp()

        await expect(get('binh', 'dm-an-binh')).resolves.toMatchObject({ id: 'dm-an-binh', user: { id: 'an' } })
        await expect(get('chi', 'dm-an-binh')).resolves.toBeNull()
    })
})

describe('What messaging and realtime ask (DM_ACCESS, DM_CHANNELS)', () => {
    it('gives a DM’s two people and when it began; nothing for a channel that is no DM', async () => {
        const { world, conversation } = await setUp()

        await expect(conversation('dm-an-binh')).resolves.toEqual({
            channelId: 'dm-an-binh',
            userIds: ['an', 'binh'],
            createdAt: world.dmRows.get('dm-an-binh')!.createdAt
        })
        await expect(conversation('hoi-dap')).resolves.toBeNull()
    })

    it('says whether one of the two may message the other now, each way on its own (REQ-SOCIAL-04)', async () => {
        const { world, canMessage } = await setUp()
        world.allowing.delete('binh')

        // Bình lets no server member write; An still does.
        await expect(canMessage('an', 'dm-an-binh')).resolves.toBe(false)
        await expect(canMessage('binh', 'dm-an-binh')).resolves.toBe(true)
        await expect(canMessage('chi', 'dm-an-binh')).resolves.toBe(false)
    })

    it('says no across a block, and to an account gone', async () => {
        const { world, canMessage } = await setUp()
        world.block('dung', 'an')

        await expect(canMessage('an', 'dm-an-dung')).resolves.toBe(false)
        await expect(canMessage('dung', 'dm-an-dung')).resolves.toBe(false)
        world.people.set('binh', { ...world.people.get('binh')!, deletedAt: new Date('2026-11-24T00:00:00Z') })
        await expect(canMessage('an', 'dm-an-binh')).resolves.toBe(false)
    })

    it('gives the DMs shown in a list for their unread, and every DM’s room, closed ones too', async () => {
        const { shown, channelIds } = await setUp()

        await expect(shown('binh')).resolves.toEqual([])
        expect((await shown('an')).map((dm) => dm.channelId).sort()).toEqual(['dm-an-binh', 'dm-an-dung'])
        await expect(channelIds('binh')).resolves.toEqual(['dm-an-binh'])
    })
})
