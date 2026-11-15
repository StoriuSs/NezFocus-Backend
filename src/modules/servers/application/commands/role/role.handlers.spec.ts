import { EventBus } from '@nestjs/cqrs'
import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCachePort } from '@/modules/permissions'
import { MemberChangedEvent } from '../../events/member-changed.event'
import { ServerChangedEvent } from '../../events/server-changed.event'
import { RoleRepositoryPort, RoleState, RoleWrite, ServerNotFoundError } from '../../../domain'
import {
    CreateRoleHandler,
    DeleteRoleHandler,
    GrantRoleHandler,
    ReorderRolesHandler,
    RevokeRoleHandler,
    UpdateRoleHandler
} from './role.handlers'
import {
    CreateRoleCommand,
    DeleteRoleCommand,
    GrantRoleCommand,
    ReorderRolesCommand,
    RevokeRoleCommand,
    UpdateRoleCommand
} from './role.commands'

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
        )
    }
    const cache = {
        serverChanged: jest.fn().mockResolvedValue(undefined),
        memberChanged: jest.fn().mockResolvedValue(undefined)
    }
    const events = { publish: jest.fn() }
    const deps = [
        repository as unknown as RoleRepositoryPort,
        cache as unknown as PermissionCachePort,
        events as unknown as EventBus
    ] as const
    const published = () => events.publish.mock.calls.map(([event]) => event as unknown)
    return { written, repository, cache, deps, published }
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
        const { cache, deps, published } = setUp(false)
        await expect(
            new UpdateRoleHandler(...deps).execute(new UpdateRoleCommand('an', 'ot', 'docs', { name: 'X' }))
        ).rejects.toThrow(ServerNotFoundError)
        expect(cache.serverChanged).not.toHaveBeenCalled()
        expect(published()).toEqual([])
    })

    describe('tells the members after the commit (D-178)', () => {
        it('a new role, which no one holds yet: no view changes', async () => {
            const { deps, published } = setUp()
            await new CreateRoleHandler(...deps).execute(new CreateRoleCommand('an', 'ot', 'Nhóm đề'))
            expect(published()).toEqual([new ServerChangedEvent('ot', [{ topic: 'role', action: 'created' }], false)])
        })

        it('new permissions of a role, which may change who views what; a new name or order does not', async () => {
            const powers = setUp()
            await new UpdateRoleHandler(...powers.deps).execute(
                new UpdateRoleCommand('an', 'ot', 'docs', { permissions: Permission.CONNECT })
            )
            expect(powers.published()).toEqual([
                new ServerChangedEvent('ot', [{ topic: 'role', action: 'updated' }], true)
            ])

            const renamed = setUp()
            await new UpdateRoleHandler(...renamed.deps).execute(
                new UpdateRoleCommand('an', 'ot', 'docs', { name: 'Đề' })
            )
            expect(renamed.published()).toEqual([
                new ServerChangedEvent('ot', [{ topic: 'role', action: 'updated' }], false)
            ])

            const moved = setUp()
            await new ReorderRolesHandler(...moved.deps).execute(
                new ReorderRolesCommand('an', 'ot', ['lead', 'docs'], ['docs', 'lead'])
            )
            expect(moved.published()).toEqual([
                new ServerChangedEvent('ot', [{ topic: 'role', action: 'updated' }], false)
            ])
        })

        it('a role deleted, its holders maybe losing a channel', async () => {
            const { deps, published } = setUp()
            await new DeleteRoleHandler(...deps).execute(new DeleteRoleCommand('an', 'ot', 'docs'))
            // The roles under it move up: one event for both.
            expect(published()).toEqual([
                new ServerChangedEvent(
                    'ot',
                    [
                        { topic: 'role', action: 'deleted' },
                        { topic: 'role', action: 'updated' }
                    ],
                    true
                )
            ])
        })

        it('each member given or losing a role, and no one when nothing changed', async () => {
            const given = setUp()
            await new GrantRoleHandler(...given.deps).execute(new GrantRoleCommand('an', 'ot', 'docs', ['binh', 'chi']))
            expect(given.published()).toEqual([
                new MemberChangedEvent('ot', 'binh', 'updated'),
                new MemberChangedEvent('ot', 'chi', 'updated')
            ])

            const taken = setUp()
            await new RevokeRoleHandler(...taken.deps).execute(new RevokeRoleCommand('an', 'ot', 'lead', 'binh'))
            expect(taken.published()).toEqual([new MemberChangedEvent('ot', 'binh', 'updated')])

            const untouched = setUp()
            await new RevokeRoleHandler(...untouched.deps).execute(new RevokeRoleCommand('an', 'ot', 'lead', 'chi'))
            expect(untouched.published()).toEqual([])
        })
    })
})
