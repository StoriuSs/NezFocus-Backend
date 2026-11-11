import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { MemberRepositoryPort, MissingPermissionError, RoleRepositoryPort, ServerNotFoundError } from '../../../domain'
import { ListMembersHandler, ListRolesHandler } from './role.handlers'
import { ListMembersQuery, ListRolesQuery } from './role.queries'

const roles = [
    { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    { id: 'docs', name: 'Nhóm tài liệu', permissions: 0n, position: 1, isEveryone: false },
    { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.MANAGE_ROLES, position: 2, isEveryone: false }
]

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
            checker as unknown as PermissionCheckerPort
        )
        await expect(handler.execute(new ListMembersQuery('chi', 'ot', search))).resolves.toEqual(page)
        expect(directory.search).toHaveBeenCalledWith('ot', search)
    })

    it('answers NOT_FOUND to anyone outside, without searching', async () => {
        const directory = { search: jest.fn() }
        const checker = { access: jest.fn().mockResolvedValue(null) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberRepositoryPort,
            checker as unknown as PermissionCheckerPort
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
                checker as unknown as PermissionCheckerPort
            )
            return (await handler.execute(new ListMembersQuery(viewer.member.userId, 'ot', search))).items[0]
        }
        expect(await listFor(access('chi'))).toEqual({ ...dung, timeoutReason: null })
        expect(await listFor(access('an'))).toEqual(dung)
    })
})
