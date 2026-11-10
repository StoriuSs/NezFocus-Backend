import {
    EVERYONE_DEFAULT_PERMISSIONS,
    Permission,
    PermissionCachePort,
    PermissionCheckerPort,
    ServerAccess
} from '@/modules/permissions'
import { MissingPermissionError, RoleState, RoleWrite, ServerNotFoundError } from '../../domain'
import { MemberDirectoryPort, RoleRepositoryPort } from '../ports'
import {
    CreateRoleHandler,
    DeleteRoleHandler,
    GrantRoleHandler,
    ListMembersHandler,
    ListRolesHandler,
    ReorderRolesHandler,
    RevokeRoleHandler,
    UpdateRoleHandler
} from './role.handlers'
import {
    CreateRoleCommand,
    DeleteRoleCommand,
    GrantRoleCommand,
    ListMembersQuery,
    ListRolesQuery,
    ReorderRolesCommand,
    RevokeRoleCommand,
    UpdateRoleCommand
} from './role.messages'

const roles = [
    { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    { id: 'docs', name: 'Nhóm tài liệu', permissions: 0n, position: 1, isEveryone: false },
    { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.MANAGE_ROLES, position: 2, isEveryone: false }
]

/** The owner An, Bình (Trưởng nhóm) and Chi (no role) in ÔT. */
const STATE: RoleState = {
    server: {
        id: 'ot',
        name: 'ÔT',
        iconKey: null,
        ownerId: 'an',
        welcomeChannelId: null,
        categories: [],
        channels: [],
        roles
    },
    member: { userId: 'an', roleIds: [], timeoutUntil: null },
    targets: [
        { userId: 'binh', roleIds: ['lead'], timeoutUntil: null },
        { userId: 'chi', roleIds: [], timeoutUntil: null }
    ]
}

/** Runs the decision on STATE, as the repository would under its lock, and records what it was asked. */
function setUp(found = true) {
    const written: RoleWrite[] = []
    const repository = {
        change: jest.fn(
            async (_serverId: string, _userId: string, _targets: string[], decide: (s: RoleState) => RoleWrite[]) => {
                if (!found) return null
                const writes = decide(STATE)
                written.push(...writes)
                return { createdId: writes.some((w) => w.kind === 'createRole') ? 'new-role' : null }
            }
        ),
        list: jest.fn().mockResolvedValue([])
    }
    const cache = {
        serverChanged: jest.fn().mockResolvedValue(undefined),
        memberChanged: jest.fn().mockResolvedValue(undefined)
    }
    const deps = [repository as unknown as RoleRepositoryPort, cache as unknown as PermissionCachePort] as const
    return { written, repository, cache, deps }
}

describe('role handlers', () => {
    it('creates a role, answers with its id and clears the cached server', async () => {
        const { cache, deps } = setUp()
        const result = await new CreateRoleHandler(...deps).execute(new CreateRoleCommand('an', 'ot', 'Nhóm đề'))
        expect(result).toEqual({ roleId: 'new-role' })
        expect(cache.serverChanged).toHaveBeenCalledWith('ot')
        expect(cache.memberChanged).not.toHaveBeenCalled()
    })

    it('clears the cached server when a role changes, moves or goes', async () => {
        for (const run of [
            (deps: ReturnType<typeof setUp>['deps']) =>
                new UpdateRoleHandler(...deps).execute(
                    new UpdateRoleCommand('an', 'ot', 'docs', { permissions: Permission.CONNECT })
                ),
            (deps: ReturnType<typeof setUp>['deps']) =>
                new ReorderRolesHandler(...deps).execute(
                    new ReorderRolesCommand('an', 'ot', ['lead', 'docs'], ['docs', 'lead'])
                ),
            (deps: ReturnType<typeof setUp>['deps']) =>
                new DeleteRoleHandler(...deps).execute(new DeleteRoleCommand('an', 'ot', 'docs'))
        ]) {
            const { cache, deps } = setUp()
            await run(deps)
            expect(cache.serverChanged).toHaveBeenCalledWith('ot')
        }
    })

    it('reads the members named under the lock and clears only theirs after a grant', async () => {
        const { repository, cache, deps } = setUp()
        await new GrantRoleHandler(...deps).execute(new GrantRoleCommand('an', 'ot', 'docs', ['binh', 'chi']))
        expect(repository.change).toHaveBeenCalledWith('ot', 'an', ['binh', 'chi'], expect.any(Function))
        expect(cache.memberChanged.mock.calls).toEqual([
            ['ot', 'binh'],
            ['ot', 'chi']
        ])
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })

    it('clears the member a role was taken from, and nobody when nothing changed', async () => {
        const taken = setUp()
        await new RevokeRoleHandler(...taken.deps).execute(new RevokeRoleCommand('an', 'ot', 'lead', 'binh'))
        expect(taken.cache.memberChanged).toHaveBeenCalledWith('ot', 'binh')

        const untouched = setUp()
        await new RevokeRoleHandler(...untouched.deps).execute(new RevokeRoleCommand('an', 'ot', 'lead', 'chi'))
        expect(untouched.cache.memberChanged).not.toHaveBeenCalled()
        expect(untouched.cache.serverChanged).not.toHaveBeenCalled()
    })

    it('answers NOT_FOUND when the server is gone or they are not in it, telling the cache nothing', async () => {
        const { cache, deps } = setUp(false)
        await expect(
            new UpdateRoleHandler(...deps).execute(new UpdateRoleCommand('an', 'ot', 'docs', { name: 'X' }))
        ).rejects.toThrow(ServerNotFoundError)
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })
})

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
    const search = { q: null, roleId: null, page: 1, limit: 50 }
    const page = { items: [], total: 0 }

    it('lists the members for anyone in the server, with no permission needed', async () => {
        const directory = { search: jest.fn().mockResolvedValue(page) }
        const checker = { access: jest.fn().mockResolvedValue(access('chi')) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberDirectoryPort,
            checker as unknown as PermissionCheckerPort
        )
        await expect(handler.execute(new ListMembersQuery('chi', 'ot', search))).resolves.toBe(page)
        expect(directory.search).toHaveBeenCalledWith('ot', search)
    })

    it('answers NOT_FOUND to anyone outside, without searching', async () => {
        const directory = { search: jest.fn() }
        const checker = { access: jest.fn().mockResolvedValue(null) }
        const handler = new ListMembersHandler(
            directory as unknown as MemberDirectoryPort,
            checker as unknown as PermissionCheckerPort
        )
        await expect(handler.execute(new ListMembersQuery('x', 'ot', search))).rejects.toThrow(ServerNotFoundError)
        expect(directory.search).not.toHaveBeenCalled()
    })
})
