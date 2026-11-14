import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { UserDirectoryPort } from '@/modules/users'
import { MemberRepositoryPort, MissingPermissionError, RoleRepositoryPort, ServerNotFoundError } from '../../../domain'
import { ListMembersHandler, ListMentionableRolesHandler, ListRolesHandler } from './role.handlers'
import { ListMembersQuery, ListMentionableRolesQuery, ListRolesQuery } from './role.queries'

const roles = [
    { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    { id: 'docs', name: 'Nhóm tài liệu', permissions: 0n, position: 1, isEveryone: false },
    { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.MANAGE_ROLES, position: 2, isEveryone: false }
]

/** Picture keys as the storage would give them out. */
const pictures = {
    avatarUrl: jest.fn((key: string | null) => Promise.resolve(key && `https://files.example.test/${key}`))
} as unknown as UserDirectoryPort

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
        limit: 50
    }
    const page = { items: [], total: 0 }

    it('lists the members for anyone in the server, with no permission needed', async () => {
        const directory = { search: jest.fn().mockResolvedValue(page) }
        const checker = { access: jest.fn().mockResolvedValue(access('chi')) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberRepositoryPort,
            checker as unknown as PermissionCheckerPort,
            pictures
        )
        await expect(handler.execute(new ListMembersQuery('chi', 'ot', search))).resolves.toEqual(page)
        expect(directory.search).toHaveBeenCalledWith('ot', search)
    })

    it('answers NOT_FOUND to anyone outside, without searching', async () => {
        const directory = { search: jest.fn() }
        const checker = { access: jest.fn().mockResolvedValue(null) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberRepositoryPort,
            checker as unknown as PermissionCheckerPort,
            pictures
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
                pictures
            )
            return (await handler.execute(new ListMembersQuery(viewer.member.userId, 'ot', search))).items[0]
        }
        expect(await listFor(access('chi'))).toEqual({ ...dung, timeoutReason: null })
        expect(await listFor(access('an'))).toEqual(dung)
    })
})
