import { EVERYONE_DEFAULT_PERMISSIONS, PermissionCachePort } from '@/modules/permissions'
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
    const deps = [servers as unknown as ServerRepositoryPort, cache as unknown as PermissionCachePort] as const
    return { written, servers, cache, deps }
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

    it('leaves the cache alone when a channel edit changes nothing', async () => {
        const { written, cache, deps } = setUp()
        await new UpdateChannelHandler(...deps).execute(
            new UpdateChannelCommand('an', 'ot', 'chung', { sendMode: 'everyone' })
        )
        expect(written).toEqual([])
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })

    it('answers NOT_FOUND when the server is gone or they are not in it, telling the cache nothing', async () => {
        const { cache, deps } = setUp(false)
        await expect(
            new DeleteChannelHandler(...deps).execute(new DeleteChannelCommand('an', 'ot', 'chung'))
        ).rejects.toBeInstanceOf(ServerNotFoundError)
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })
})
