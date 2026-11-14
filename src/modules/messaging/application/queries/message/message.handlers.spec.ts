import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, RoleDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { ChannelNotFoundError, MessageRecord, MessageRepositoryPort, ReactionRepositoryPort } from '../../../domain'
import { ListMessagesQuery } from './message.queries'
import { ListMessagesHandler } from './message.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [
        { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'ban-can-su', type: 'text', isPrivate: true, viewRoleIds: [], sendMode: 'everyone' }
    ]
}

const message = (id: string, authorId: string | null, avatarKey: string | null = null): MessageRecord => ({
    id,
    channelId: 'hoi-dap',
    type: authorId ? 'regular' : 'system',
    author: authorId ? { id: authorId, username: authorId, displayName: authorId, avatarKey } : null,
    content: authorId ? `Tin ${id}` : '',
    systemEvent: authorId ? null : 'member_joined',
    systemData: authorId ? null : { userId: 'dung' },
    replyTo: null,
    mentionEveryone: false,
    mentionRoleIds: [],
    mentionUsers: [],
    editedAt: null,
    pinned: false,
    systemUser: null,
    createdAt: new Date('2026-10-18T20:02:00Z')
})

function world(roles: RoleDirectoryPort = { rolesOf: jest.fn(async () => []) }) {
    const repository = {
        page: jest.fn().mockResolvedValue({
            items: [
                message('m1', 'binh', 'avatars/binh.webp'),
                message('m2', 'binh', 'avatars/binh.webp'),
                {
                    ...message('m3', null),
                    systemUser: { id: 'dung', username: 'dung', displayName: 'Dũng', avatarKey: 'avatars/dung.webp' }
                },
                {
                    ...message('m4', 'chi'),
                    replyTo: {
                        id: 'm1',
                        author: { id: 'binh', username: 'binh', displayName: 'binh', avatarKey: 'avatars/binh.webp' },
                        content: 'Tin m1',
                        deleted: false,
                        mentionRoleIds: [],
                        mentionUsers: []
                    }
                }
            ],
            hasMoreBefore: true,
            hasMoreAfter: false
        })
    }
    const channels: ChannelDirectoryPort = { serverIdOf: jest.fn().mockResolvedValue('ot') }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: { userId, roleIds: [], timeoutUntil: null }
        }))
    }
    const users = { avatarUrl: jest.fn(async (key: string | null) => (key ? `https://cdn.test/${key}` : null)) }
    const reactions = {
        summaries: jest.fn(
            async () =>
                new Map([
                    [
                        'm2',
                        [
                            { emoji: '👍', count: 3, me: true },
                            { emoji: '🎉', count: 1, me: false }
                        ]
                    ]
                ])
        )
    }
    const handler = new ListMessagesHandler(
        repository as unknown as MessageRepositoryPort,
        reactions as unknown as ReactionRepositoryPort,
        channels,
        checker,
        users as unknown as UserDirectoryPort,
        roles
    )
    return { handler, repository, reactions, users }
}

describe('ListMessagesHandler (SRS 5.1)', () => {
    it('reads the page asked for, and gives each picture as an address, those of quoted authors too, signed once per picture', async () => {
        const { handler, repository, users } = world()

        const page = await handler.execute(new ListMessagesQuery('binh', 'hoi-dap', { kind: 'before', id: 'm9' }, 4))

        expect(repository.page).toHaveBeenCalledWith('hoi-dap', { kind: 'before', id: 'm9' }, 4)
        expect(page.items.map((item) => [item.id, item.author?.avatarUrl ?? null])).toEqual([
            ['m1', 'https://cdn.test/avatars/binh.webp'],
            ['m2', 'https://cdn.test/avatars/binh.webp'],
            ['m3', null],
            ['m4', null]
        ])
        expect(page.items[3]?.replyTo?.author?.avatarUrl).toBe('https://cdn.test/avatars/binh.webp')
        expect(page.items[2]?.systemUser?.avatarUrl).toBe('https://cdn.test/avatars/dung.webp')
        expect(users.avatarUrl).toHaveBeenCalledTimes(2)
        expect([page.hasMoreBefore, page.hasMoreAfter]).toEqual([true, false])
    })

    it('gives each message its reactions as the reader sees them, none for the others (REQ-MSG-05)', async () => {
        const { handler, reactions } = world()

        const page = await handler.execute(new ListMessagesQuery('binh', 'hoi-dap', { kind: 'latest' }, 4))

        expect(reactions.summaries).toHaveBeenCalledWith(['m1', 'm2', 'm3', 'm4'], 'binh')
        expect(page.items.map((item) => item.reactions)).toEqual([
            [],
            [
                { emoji: '👍', count: 3, me: true },
                { emoji: '🎉', count: 1, me: false }
            ],
            [],
            []
        ])
    })

    it('names the people and roles mentioned as they are now, a reply line too, leaving out deleted roles (D-171)', async () => {
        const chi = { id: 'chi', username: 'chi.le', displayName: 'Chi', avatarKey: 'avatars/chi.webp' }
        const roles = { rolesOf: jest.fn(async () => [{ id: 'tro-giang', name: 'Trợ giảng K24', mentionable: true }]) }
        const { handler, repository } = world(roles)
        repository.page.mockResolvedValueOnce({
            items: [
                {
                    ...message('m5', 'binh'),
                    mentionRoleIds: ['tro-giang', 'da-xoa'],
                    mentionUsers: [chi],
                    replyTo: {
                        id: 'm1',
                        author: null,
                        content: 'Tin m1',
                        deleted: false,
                        mentionRoleIds: ['tro-giang'],
                        mentionUsers: [chi]
                    }
                }
            ],
            hasMoreBefore: false,
            hasMoreAfter: false
        })

        const [item] = (await handler.execute(new ListMessagesQuery('binh', 'hoi-dap', { kind: 'latest' }, 4))).items

        expect(item).toMatchObject({
            mentionUsers: [{ id: 'chi', username: 'chi.le', displayName: 'Chi' }],
            mentionRoles: [{ id: 'tro-giang', name: 'Trợ giảng K24' }],
            replyTo: {
                mentionUsers: [{ id: 'chi', username: 'chi.le', displayName: 'Chi' }],
                mentionRoles: [{ id: 'tro-giang', name: 'Trợ giảng K24' }]
            }
        })
        expect(item?.mentionUsers[0]).not.toHaveProperty('avatarKey')
        expect(roles.rolesOf).toHaveBeenCalledTimes(1)
        expect(roles.rolesOf).toHaveBeenCalledWith('ot', ['tro-giang', 'da-xoa'])
    })

    it('answers not found for a channel the member does not see', async () => {
        const { handler, repository } = world()
        await expect(
            handler.execute(new ListMessagesQuery('binh', 'ban-can-su', { kind: 'latest' }, 50))
        ).rejects.toBeInstanceOf(ChannelNotFoundError)
        expect(repository.page).not.toHaveBeenCalled()
    })
})
