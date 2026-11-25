import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { UserDirectoryPort } from '@/modules/users'
import { MemberActivityPort, PresenceReaderPort } from '../../ports'
import {
    ChannelNotFoundError,
    MemberNotFoundError,
    MemberRepositoryPort,
    MissingPermissionError,
    RoleRepositoryPort,
    ServerNotFoundError
} from '../../../domain'
import { GetMemberHandler, ListMembersHandler, ListMentionableRolesHandler, ListRolesHandler } from './role.handlers'
import { GetMemberQuery, ListMembersQuery, ListMentionableRolesQuery, ListRolesQuery } from './role.queries'

const roles = [
    { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    { id: 'docs', name: 'Nhóm tài liệu', permissions: 0n, position: 1, isEveryone: false },
    { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.MANAGE_ROLES, position: 2, isEveryone: false }
]

/** Picture keys as the storage would give them out. */
const pictures = {
    avatarUrl: jest.fn((key: string | null) => Promise.resolve(key && `https://files.example.test/${key}`))
} as unknown as UserDirectoryPort

/** Who others see now: Bình away, Chi online; everyone else offline. */
const presence: PresenceReaderPort = {
    everyoneShown: async () =>
        new Map([
            ['binh', 'idle'],
            ['chi', 'online']
        ])
}

/** Bình studies alone; nobody else shows any activity (D-247). */
const activity: MemberActivityPort = {
    activitiesOf: async (userIds) =>
        new Map(
            userIds
                .filter((userId) => userId === 'binh')
                .map((userId) => [
                    userId,
                    { room: null, solo: { status: 'paused', phase: 'focus', phaseEndsAt: null } }
                ])
        )
}

const access = (userId: string, roleIds: string[] = []): ServerAccess => ({
    server: { ownerId: 'an', roles, channels: [] },
    member: { userId, roleIds, timeoutUntil: null }
})

describe('ListRolesHandler', () => {
    const repository = { list: jest.fn().mockResolvedValue([{ id: 'e' }]) } as unknown as RoleRepositoryPort

    it('lists the roles for someone holding MANAGE_ROLES', async () => {
        const checker = { access: jest.fn().mockResolvedValue(access('binh', ['lead'])) }
        const handler = new ListRolesHandler(repository, checker as unknown as PermissionCheckerPort)
        await expect(handler.execute(new ListRolesQuery('binh', 'ot'))).resolves.toEqual([{ id: 'e' }])
    })

    it('refuses a member without it, and answers NOT_FOUND to anyone outside', async () => {
        const member = { access: jest.fn().mockResolvedValue(access('chi')) }
        await expect(
            new ListRolesHandler(repository, member as unknown as PermissionCheckerPort).execute(
                new ListRolesQuery('chi', 'ot')
            )
        ).rejects.toThrow(MissingPermissionError)
        const outsider = { access: jest.fn().mockResolvedValue(null) }
        await expect(
            new ListRolesHandler(repository, outsider as unknown as PermissionCheckerPort).execute(
                new ListRolesQuery('x', 'ot')
            )
        ).rejects.toThrow(ServerNotFoundError)
    })
})

describe('ListMentionableRolesHandler (REQ-MSG-03, D-171)', () => {
    const listed = [
        { id: 'lead', name: 'Trưởng nhóm', mentionable: true, isEveryone: false, memberCount: 2 },
        { id: 'docs', name: 'Nhóm tài liệu', mentionable: false, isEveryone: false, memberCount: 1 },
        { id: 'e', name: '@everyone', mentionable: false, isEveryone: true, memberCount: 9 }
    ]
    const repository = { list: jest.fn().mockResolvedValue(listed) } as unknown as RoleRepositoryPort
    const run = (found: ServerAccess | null, userId = 'chi') =>
        new ListMentionableRolesHandler(repository, {
            access: jest.fn().mockResolvedValue(found)
        } as unknown as PermissionCheckerPort).execute(new ListMentionableRolesQuery(userId, 'ot'))

    it('gives any member the roles everyone may mention, never @everyone itself', async () => {
        await expect(run(access('chi'))).resolves.toEqual([{ id: 'lead', name: 'Trưởng nhóm', memberCount: 2 }])
    })

    it('gives every role but @everyone to someone with MENTION_EVERYONE', async () => {
        const mentioning = {
            server: {
                ownerId: 'an',
                roles: [
                    ...roles,
                    { id: 'm', permissions: Permission.MENTION_EVERYONE, position: 3, isEveryone: false }
                ],
                channels: []
            },
            member: { userId: 'binh', roleIds: ['m'], timeoutUntil: null }
        }
        await expect(run(mentioning, 'binh')).resolves.toEqual([
            { id: 'lead', name: 'Trưởng nhóm', memberCount: 2 },
            { id: 'docs', name: 'Nhóm tài liệu', memberCount: 1 }
        ])
    })

    it('answers NOT_FOUND to anyone outside', async () => {
        await expect(run(null, 'x')).rejects.toThrow(ServerNotFoundError)
    })
})

describe('ListMembersHandler (D-152)', () => {
    const search = {
        q: null,
        roleId: null,
        transferableFrom: null,
        sort: 'name' as const,
        order: 'asc' as const,
        page: 1,
        limit: 50,
        presence: null
    }
    const page = { items: [], total: 0 }

    it('lists the members for anyone in the server, with no permission needed', async () => {
        const directory = { search: jest.fn().mockResolvedValue(page) }
        const checker = { access: jest.fn().mockResolvedValue(access('chi')) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberRepositoryPort,
            checker as unknown as PermissionCheckerPort,
            pictures,
            presence,
            activity
        )
        await expect(handler.execute(new ListMembersQuery('chi', 'ot', search))).resolves.toEqual(page)
        expect(directory.search).toHaveBeenCalledWith('ot', { ...search, viewers: null }, ['binh', 'chi'])
    })

    it('lists only those who view a channel, for whoever views it, NOT_FOUND to the rest (D-192)', async () => {
        const docsOnly = {
            id: 'tai-lieu',
            type: 'text' as const,
            isPrivate: true,
            viewRoleIds: ['docs'],
            sendMode: 'everyone' as const,
            taskBoardEnabled: true
        }
        const viewerAccess = (userId: string, roleIds: string[] = []): ServerAccess => ({
            server: { ownerId: 'an', roles, channels: [docsOnly] },
            member: { userId, roleIds, timeoutUntil: null }
        })
        const directory = { search: jest.fn().mockResolvedValue(page) }
        const handlerFor = (viewer: ServerAccess) =>
            new ListMembersHandler(
                directory as unknown as MemberRepositoryPort,
                { access: jest.fn().mockResolvedValue(viewer) } as unknown as PermissionCheckerPort,
                pictures,
                presence,
                activity
            )

        await handlerFor(viewerAccess('binh', ['docs'])).execute(new ListMembersQuery('binh', 'ot', search, 'tai-lieu'))
        expect(directory.search).toHaveBeenCalledWith('ot', { ...search, viewers: { anyOf: [], allOf: [['docs']] } }, [
            'binh',
            'chi'
        ])

        directory.search.mockClear()
        await expect(
            handlerFor(viewerAccess('chi')).execute(new ListMembersQuery('chi', 'ot', search, 'tai-lieu'))
        ).rejects.toThrow(ChannelNotFoundError)
        await expect(
            handlerFor(viewerAccess('binh', ['docs'])).execute(new ListMembersQuery('binh', 'ot', search, 'khac'))
        ).rejects.toThrow(ChannelNotFoundError)
        expect(directory.search).not.toHaveBeenCalled()
    })

    it('answers NOT_FOUND to anyone outside, without searching', async () => {
        const directory = { search: jest.fn() }
        const checker = { access: jest.fn().mockResolvedValue(null) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberRepositoryPort,
            checker as unknown as PermissionCheckerPort,
            pictures,
            presence,
            activity
        )
        await expect(handler.execute(new ListMembersQuery('x', 'ot', search))).rejects.toThrow(ServerNotFoundError)
        expect(directory.search).not.toHaveBeenCalled()
    })

    it('shows a running timeout to all, its reason only to those who may time people out (D-154)', async () => {
        const dung = {
            userId: 'dung',
            timeoutUntil: new Date('2999-01-01T00:00:00Z'),
            timeoutReason: 'Gửi tin liên tục'
        }
        const directory = { search: jest.fn().mockResolvedValue({ items: [dung], total: 1 }) }
        const listFor = async (viewer: ServerAccess) => {
            const checker = { access: jest.fn().mockResolvedValue(viewer) }
            const handler = new ListMembersHandler(
                directory as unknown as MemberRepositoryPort,
                checker as unknown as PermissionCheckerPort,
                pictures,
                presence,
                activity
            )
            return (await handler.execute(new ListMembersQuery(viewer.member.userId, 'ot', search))).items[0]
        }
        expect(await listFor(access('chi'))).toEqual({
            ...dung,
            timeoutReason: null,
            status: 'offline',
            activity: null
        })
        expect(await listFor(access('an'))).toEqual({ ...dung, status: 'offline', activity: null })
    })

    it('gives each member what others see of them, offline for anyone not shown (REQ-AUTH-07, D-175)', async () => {
        const members = [
            { userId: 'binh', timeoutUntil: null },
            { userId: 'dung', timeoutUntil: null }
        ]
        const directory = { search: jest.fn().mockResolvedValue({ items: members, total: 2 }) }
        const checker = { access: jest.fn().mockResolvedValue(access('chi')) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberRepositoryPort,
            checker as unknown as PermissionCheckerPort,
            pictures,
            presence,
            activity
        )

        const { items } = await handler.execute(new ListMembersQuery('chi', 'ot', { ...search, presence: 'online' }))

        expect(items.map(({ userId, status }) => ({ userId, status }))).toEqual([
            { userId: 'binh', status: 'idle' },
            { userId: 'dung', status: 'offline' }
        ])
    })

    it('gives each member their study activity line, null for one who shows none (D-108, D-240)', async () => {
        const members = [
            { userId: 'binh', timeoutUntil: null },
            { userId: 'dung', timeoutUntil: null }
        ]
        const directory = { search: jest.fn().mockResolvedValue({ items: members, total: 2 }) }
        const checker = { access: jest.fn().mockResolvedValue(access('chi')) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberRepositoryPort,
            checker as unknown as PermissionCheckerPort,
            pictures,
            presence,
            activity
        )

        const { items } = await handler.execute(new ListMembersQuery('chi', 'ot', search))

        expect(items.map(({ userId, activity }) => ({ userId, activity }))).toEqual([
            { userId: 'binh', activity: { room: null, solo: { status: 'paused', phase: 'focus', phaseEndsAt: null } } },
            { userId: 'dung', activity: null }
        ])
    })
})

describe('GetMemberHandler (D-252)', () => {
    const binh = {
        userId: 'binh',
        avatarUrl: 'avatars/binh.png',
        timeoutUntil: new Date('2999-01-01T00:00:00Z'),
        timeoutReason: 'Gửi tin liên tục'
    }
    const handlerFor = (viewer: ServerAccess | null, found: unknown = binh) => {
        const members = { findListed: jest.fn().mockResolvedValue(found) }
        const handler = new GetMemberHandler(
            members as unknown as MemberRepositoryPort,
            { access: jest.fn().mockResolvedValue(viewer) } as unknown as PermissionCheckerPort,
            pictures,
            presence,
            activity
        )
        return { handler, members }
    }

    it('gives anyone in the server one member as the list does: picture address, presence, activity', async () => {
        const { handler, members } = handlerFor(access('chi'))

        await expect(handler.execute(new GetMemberQuery('chi', 'ot', 'binh'))).resolves.toEqual({
            ...binh,
            avatarUrl: 'https://files.example.test/avatars/binh.png',
            timeoutReason: null,
            status: 'idle',
            activity: { room: null, solo: { status: 'paused', phase: 'focus', phaseEndsAt: null } }
        })
        expect(members.findListed).toHaveBeenCalledWith('ot', 'binh')
    })

    it('shows the timeout reason only to those who may time people out (D-154)', async () => {
        const { handler } = handlerFor(access('an'))

        await expect(handler.execute(new GetMemberQuery('an', 'ot', 'binh'))).resolves.toMatchObject({
            timeoutReason: 'Gửi tin liên tục'
        })
    })

    it('answers NOT_FOUND to anyone outside, without reading the member', async () => {
        const { handler, members } = handlerFor(null)

        await expect(handler.execute(new GetMemberQuery('x', 'ot', 'binh'))).rejects.toThrow(ServerNotFoundError)
        expect(members.findListed).not.toHaveBeenCalled()
    })

    it('answers NOT_FOUND for someone no longer in the server (the popover then shows them as outside)', async () => {
        const { handler } = handlerFor(access('chi'), null)

        await expect(handler.execute(new GetMemberQuery('chi', 'ot', 'dung'))).rejects.toThrow(MemberNotFoundError)
    })
})
