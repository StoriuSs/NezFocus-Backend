import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import {
    MessageNotFoundError,
    MessageRepositoryPort,
    REACTORS_SHOWN,
    ReactionRepositoryPort,
    StoredMessage
} from '../../../domain'
import { ListReactorsQuery } from './reaction.queries'
import { ListReactorsHandler } from './reaction.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [
        { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'ban-quan-ly', type: 'text', isPrivate: true, viewRoleIds: ['quan-ly'], sendMode: 'everyone' }
    ]
}

const stored = (id: string, channelId: string): StoredMessage => ({
    id,
    channelId,
    type: 'regular',
    author: { id: 'dung', username: 'dung', displayName: 'Dũng', avatarKey: null },
    content: 'Mình làm xong câu 2 rồi',
    systemEvent: null,
    systemData: null,
    replyTo: null,
    mentionEveryone: false,
    mentionRoleIds: [],
    mentionUsers: [],
    editedAt: null,
    pinned: false,
    systemUser: null,
    createdAt: new Date('2026-10-18T20:06:00Z'),
    deleted: false
})

function world() {
    const messages = {
        find: jest.fn(async (id: string) =>
            id === 'm1' ? stored('m1', 'hoi-dap') : id === 'm2' ? stored('m2', 'ban-quan-ly') : null
        )
    }
    const reactions = {
        reactors: jest.fn(async () => ({
            users: [
                { id: 'binh', username: 'binh.nguyen', displayName: 'Bình', avatarKey: 'avatars/binh.webp' },
                { id: 'chi', username: 'chi.le', displayName: null, avatarKey: null },
                { id: 'dung', username: null, displayName: null, avatarKey: null }
            ],
            count: 8
        }))
    }
    const channels: ChannelDirectoryPort = { serverIdOf: jest.fn(async () => 'ot') }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: { userId, roleIds: [], timeoutUntil: userId === 'phong' ? new Date(Date.now() + 3600_000) : null }
        }))
    }
    const handler = new ListReactorsHandler(
        messages as unknown as MessageRepositoryPort,
        reactions as unknown as ReactionRepositoryPort,
        channels,
        checker
    )
    return { handler, reactions }
}

describe('ListReactorsHandler (SRS 1.71: the reaction tooltip)', () => {
    it('names the first three people to give the emoji, in that order, and counts them all', async () => {
        const { handler, reactions } = world()

        const reactors = await handler.execute(new ListReactorsQuery('an', 'm1', '👍'))

        expect(reactions.reactors).toHaveBeenCalledWith('m1', '👍', REACTORS_SHOWN)
        expect(reactors).toEqual({
            users: [
                { id: 'binh', username: 'binh.nguyen', displayName: 'Bình' },
                { id: 'chi', username: 'chi.le', displayName: null },
                { id: 'dung', username: null, displayName: null }
            ],
            count: 8
        })
    })

    it('lets someone timed out read it: reading is not reacting', async () => {
        const { handler } = world()
        await expect(handler.execute(new ListReactorsQuery('phong', 'm1', '👍'))).resolves.toMatchObject({ count: 8 })
    })

    it('answers not found for a message in a channel they do not see', async () => {
        const { handler, reactions } = world()
        await expect(handler.execute(new ListReactorsQuery('binh', 'm2', '👍'))).rejects.toBeInstanceOf(
            MessageNotFoundError
        )
        expect(reactions.reactors).not.toHaveBeenCalled()
    })
})
