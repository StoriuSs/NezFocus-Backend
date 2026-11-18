import { EventBus } from '@nestjs/cqrs'
import { EVERYONE_DEFAULT_PERMISSIONS, PermissionCachePort } from '@/modules/permissions'
import { ServerChangedEvent } from '../../events/server-changed.event'
import { LayoutState, LayoutWrite, ServerNotFoundError, ServerRepositoryPort } from '../../../domain'
import {
    CreateCategoryCommand,
    CreateChannelCommand,
    DeleteCategoryCommand,
    DeleteChannelCommand,
    MoveInLayoutCommand,
    RenameCategoryCommand,
    UpdateChannelCommand
} from './channel-layout.commands'
import {
    CreateCategoryHandler,
    CreateChannelHandler,
    DeleteCategoryHandler,
    DeleteChannelHandler,
    MoveInLayoutHandler,
    RenameCategoryHandler,
    UpdateChannelHandler
} from './channel-layout.handlers'

/** The owner, in a server with one category holding one text channel. */
const STATE: LayoutState = {
    server: {
        id: 'ot',
        name: 'ÔT',
        iconKey: null,
        ownerId: 'an',
        welcomeChannelId: null,
        categories: [{ id: 'info', name: 'Thông tin', position: 0 }],
        channels: [
            {
                id: 'chung',
                categoryId: 'info',
                type: 'text',
                name: 'chung',
                position: 0,
                isPrivate: false,
                viewRoleIds: [],
                sendMode: 'everyone',
                isStudyRoom: false,
                taskBoardEnabled: false
            }
        ],
        roles: [
            { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }
        ]
    },
    member: { userId: 'an', roleIds: [], timeoutUntil: null }
}

/** Runs the decision on STATE, as the repository would under its lock, and records the writes. */
function setUp(found = true) {
    const written: LayoutWrite[] = []
    const servers = {
        changeLayout: jest.fn(async (_serverId: string, _userId: string, decide: (s: LayoutState) => LayoutWrite[]) => {
            if (!found) return null
            const writes = decide(STATE)
            written.push(...writes)
            const creates = writes.some((w) => w.kind === 'createCategory' || w.kind === 'createChannel')
            return { createdId: creates ? 'new-id' : null }
        })
    }
    const cache = { serverChanged: jest.fn().mockResolvedValue(undefined) }
    const events = { publish: jest.fn() }
    const deps = [
        servers as unknown as ServerRepositoryPort,
        cache as unknown as PermissionCachePort,
        events as unknown as EventBus
    ] as const
    const published = () => events.publish.mock.calls.map(([event]) => event as unknown)
    return { written, servers, cache, deps, published }
}

describe('channel list handlers', () => {
    it('creates a category and answers with its id, leaving the permission cache alone', async () => {
        const { written, cache, deps } = setUp()
        const result = await new CreateCategoryHandler(...deps).execute(new CreateCategoryCommand('an', 'ot', 'Ôn tập'))
        expect(result).toEqual({ categoryId: 'new-id' })
        expect(written.map((w) => w.kind)).toEqual(['createCategory'])
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })

    it('creates a channel and clears the cached server after the commit', async () => {
        const { servers, cache, deps } = setUp()
        const draft = {
            type: 'text' as const,
            name: 'Hỏi đáp',
            categoryId: null,
            isStudyRoom: false,
            isPrivate: false,
            viewRoleIds: []
        }
        const result = await new CreateChannelHandler(...deps).execute(new CreateChannelCommand('an', 'ot', draft))
        expect(result).toEqual({ channelId: 'new-id' })
        expect(servers.changeLayout).toHaveBeenCalledWith('ot', 'an', expect.any(Function))
        expect(cache.serverChanged).toHaveBeenCalledWith('ot')
    })

    it('clears the cache on channel edits and deletes, not on category edits or moves', async () => {
        const { written, cache, deps } = setUp()
        await new RenameCategoryHandler(...deps).execute(new RenameCategoryCommand('an', 'ot', 'info', 'Chung'))
        await new MoveInLayoutHandler(...deps).execute(
            new MoveInLayoutCommand('an', 'ot', { kind: 'channel', id: 'chung', categoryId: null, afterId: null })
        )
        await new DeleteCategoryHandler(...deps).execute(new DeleteCategoryCommand('an', 'ot', 'info'))
        expect(cache.serverChanged).not.toHaveBeenCalled()

        await new UpdateChannelHandler(...deps).execute(
            new UpdateChannelCommand('an', 'ot', 'chung', { sendMode: 'managers' })
        )
        await new DeleteChannelHandler(...deps).execute(new DeleteChannelCommand('an', 'ot', 'chung'))
        expect(cache.serverChanged).toHaveBeenCalledTimes(2)
        expect(written.map((w) => w.kind)).toEqual([
            'renameCategory',
            'placeChannels',
            'placeChannels',
            'deleteCategory',
            'updateChannel',
            'deleteChannel'
        ])
    })

    it('names the channels whose Task Board was turned on, so their reminders are set again (REQ-TASK-01)', async () => {
        const { deps, published } = setUp()
        await new UpdateChannelHandler(...deps).execute(
            new UpdateChannelCommand('an', 'ot', 'chung', { taskBoardEnabled: true })
        )
        await new UpdateChannelHandler(...deps).execute(
            new UpdateChannelCommand('an', 'ot', 'chung', { sendMode: 'managers' })
        )
        expect(published()).toEqual([
            expect.objectContaining({ serverId: 'ot', boardsTurnedOn: ['chung'] }),
            expect.objectContaining({ serverId: 'ot', boardsTurnedOn: [] })
        ])
    })

    it('leaves the cache alone when a channel edit changes nothing', async () => {
        const { written, cache, deps } = setUp()
        await new UpdateChannelHandler(...deps).execute(
            new UpdateChannelCommand('an', 'ot', 'chung', { sendMode: 'everyone' })
        )
        expect(written).toEqual([])
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })

    it('answers NOT_FOUND when the server is gone or they are not in it, telling the cache nothing', async () => {
        const { cache, deps, published } = setUp(false)
        await expect(
            new DeleteChannelHandler(...deps).execute(new DeleteChannelCommand('an', 'ot', 'chung'))
        ).rejects.toBeInstanceOf(ServerNotFoundError)
        expect(cache.serverChanged).not.toHaveBeenCalled()
        expect(published()).toEqual([])
    })

    describe('tells the members after the commit (D-178)', () => {
        const changed = (changes: ConstructorParameters<typeof ServerChangedEvent>[1], viewChanged: boolean) =>
            new ServerChangedEvent('ot', changes, viewChanged)

        it('a new channel, which some may now view; a new category, which changes no view', async () => {
            const channel = setUp()
            const draft = {
                type: 'text' as const,
                name: 'moi',
                categoryId: null,
                isStudyRoom: false,
                isPrivate: false,
                viewRoleIds: []
            }
            await new CreateChannelHandler(...channel.deps).execute(new CreateChannelCommand('an', 'ot', draft))
            expect(channel.published()).toEqual([changed([{ topic: 'channel', action: 'created' }], true)])

            const category = setUp()
            await new CreateCategoryHandler(...category.deps).execute(new CreateCategoryCommand('an', 'ot', 'Ôn tập'))
            expect(category.published()).toEqual([changed([{ topic: 'category', action: 'created' }], false)])
        })

        it('a channel made private or deleted, which may change who views it; a new name or who may post does not', async () => {
            const closed = setUp()
            await new UpdateChannelHandler(...closed.deps).execute(
                new UpdateChannelCommand('an', 'ot', 'chung', { isPrivate: true })
            )
            expect(closed.published()).toEqual([changed([{ topic: 'channel', action: 'updated' }], true)])

            const edited = setUp()
            await new UpdateChannelHandler(...edited.deps).execute(
                new UpdateChannelCommand('an', 'ot', 'chung', { sendMode: 'managers', name: 'chung-2' })
            )
            expect(edited.published()).toEqual([changed([{ topic: 'channel', action: 'updated' }], false)])

            const deleted = setUp()
            await new DeleteChannelHandler(...deleted.deps).execute(new DeleteChannelCommand('an', 'ot', 'chung'))
            expect(deleted.published()).toEqual([changed([{ topic: 'channel', action: 'deleted' }], true)])
        })

        it('categories renamed, moved or deleted and channels moved, once each, changing no view', async () => {
            const renamed = setUp()
            await new RenameCategoryHandler(...renamed.deps).execute(
                new RenameCategoryCommand('an', 'ot', 'info', 'Chung')
            )
            expect(renamed.published()).toEqual([changed([{ topic: 'category', action: 'updated' }], false)])

            const moved = setUp()
            await new MoveInLayoutHandler(...moved.deps).execute(
                new MoveInLayoutCommand('an', 'ot', { kind: 'channel', id: 'chung', categoryId: null, afterId: null })
            )
            expect(moved.published()).toEqual([changed([{ topic: 'channel', action: 'updated' }], false)])

            const deleted = setUp()
            await new DeleteCategoryHandler(...deleted.deps).execute(new DeleteCategoryCommand('an', 'ot', 'info'))
            // Its channels move to the top of the list first.
            expect(deleted.published()).toEqual([
                changed(
                    [
                        { topic: 'channel', action: 'updated' },
                        { topic: 'category', action: 'deleted' }
                    ],
                    false
                )
            ])
        })

        it('nothing when an edit changes nothing', async () => {
            const { deps, published } = setUp()
            await new UpdateChannelHandler(...deps).execute(
                new UpdateChannelCommand('an', 'ot', 'chung', { sendMode: 'everyone' })
            )
            expect(published()).toEqual([])
        })
    })
})
