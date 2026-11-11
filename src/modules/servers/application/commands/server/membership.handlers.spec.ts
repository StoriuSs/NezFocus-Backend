import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { CurrentPasswordPort } from '@/modules/auth'
import { EVERYONE_DEFAULT_PERMISSIONS, PermissionCachePort } from '@/modules/permissions'
import { AccountDeletedEvent } from '@/modules/users'
import {
    MembershipState,
    MembershipWrite,
    NotOwnerError,
    OwnerCannotLeaveError,
    purgeDeletedBefore,
    ServerNotFoundError,
    ServerRepositoryPort
} from '../../../domain'
import { FileCleanupPort } from '../../ports'
import { ForgetDeletedAccountHandler } from '../../events/handlers/forget-deleted-account.handler'
import {
    CleanUpServersCommand,
    DeleteServerCommand,
    ForgetDeletedMemberCommand,
    LeaveServerCommand,
    TransferOwnershipCommand
} from './server.commands'
import {
    CleanUpServersHandler,
    DeleteServerHandler,
    ForgetDeletedMemberHandler,
    LeaveServerHandler,
    TransferOwnershipHandler
} from './server.handlers'

const NOW = new Date('2026-11-11T09:00:00Z')

/** ÔT: An owns it, Bình is a member with no role. */
const stateFor = (userId: string, overrides: Partial<MembershipState> = {}): MembershipState => ({
    server: {
        id: 'ot',
        name: 'Ôn thi Giải tích 2',
        iconKey: null,
        ownerId: 'an',
        welcomeChannelId: null,
        categories: [],
        channels: [],
        roles: [
            { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }
        ]
    },
    member: { userId, roleIds: [], timeoutUntil: null },
    otherMembers: 1,
    target: null,
    ...overrides
})

/**
 * Runs the decision on `state`, as the repository would under its lock, and
 * records the writes and what the cache was told, in order.
 */
function world(state: MembershipState | null) {
    const log: string[] = []
    const written: MembershipWrite[] = []
    const servers = {
        changeMembership: jest.fn(async (_s: string, _u: string, _t: string | null, decide) => {
            if (!state) return false
            const writes = (decide as (state: MembershipState) => MembershipWrite[])(state)
            written.push(...writes)
            log.push('commit')
            return true
        })
    }
    const cache = {
        serverChanged: jest.fn(async (serverId: string) => void log.push(`serverChanged ${serverId}`)),
        memberChanged: jest.fn(
            async (serverId: string, userId: string) => void log.push(`memberChanged ${serverId} ${userId}`)
        )
    }
    return {
        log,
        written,
        servers: servers as unknown as ServerRepositoryPort,
        cache: cache as unknown as PermissionCachePort
    }
}

describe('LeaveServerHandler', () => {
    it('takes them out, then tells the cache they are no longer a member', async () => {
        const w = world(stateFor('binh'))
        await new LeaveServerHandler(w.servers, w.cache).execute(new LeaveServerCommand('binh', 'ot'))

        expect(w.written).toEqual([{ kind: 'leave', userId: 'binh' }])
        expect(w.log).toEqual(['commit', 'memberChanged ot binh'])
    })

    it('refuses the owner, and tells the cache nothing', async () => {
        const w = world(stateFor('an'))
        await expect(
            new LeaveServerHandler(w.servers, w.cache).execute(new LeaveServerCommand('an', 'ot'))
        ).rejects.toThrow(OwnerCannotLeaveError)
        expect(w.log).toEqual([])
    })

    it('answers not found when the server is gone or they are not in it', async () => {
        const w = world(null)
        await expect(
            new LeaveServerHandler(w.servers, w.cache).execute(new LeaveServerCommand('binh', 'ot'))
        ).rejects.toThrow(ServerNotFoundError)
    })
})

describe('DeleteServerHandler', () => {
    it('deletes the server when the owner types its name, then tells the cache', async () => {
        const w = world(stateFor('an'))
        await new DeleteServerHandler(w.servers, w.cache).execute(
            new DeleteServerCommand('an', 'ot', 'ON THI GIAI TICH 2')
        )

        expect(w.written).toEqual([{ kind: 'deleteServer' }])
        expect(w.log).toEqual(['commit', 'serverChanged ot'])
    })

    it('refuses another name, and a member who is not the owner', async () => {
        const wrongName = world(stateFor('an'))
        await expect(
            new DeleteServerHandler(wrongName.servers, wrongName.cache).execute(
                new DeleteServerCommand('an', 'ot', 'ÔT')
            )
        ).rejects.toMatchObject({ errorKey: 'VALIDATION_ERROR', details: { rule: 'name_mismatch' } })

        const member = world(stateFor('binh'))
        await expect(
            new DeleteServerHandler(member.servers, member.cache).execute(
                new DeleteServerCommand('binh', 'ot', 'Ôn thi Giải tích 2')
            )
        ).rejects.toThrow(NotOwnerError)
        expect([...wrongName.log, ...member.log]).toEqual([])
    })
})

describe('TransferOwnershipHandler', () => {
    const binh = { userId: 'binh', roleIds: [], timeoutUntil: null, pendingDeletion: false }

    function setUp(passwordRight: boolean) {
        const w = world(stateFor('an', { target: binh }))
        const passwords = {
            confirm: jest.fn(async () => {
                w.log.push('password')
                if (!passwordRight) throw new Error('wrong password')
            })
        }
        const handler = new TransferOwnershipHandler(w.servers, w.cache, passwords as unknown as CurrentPasswordPort)
        return { w, passwords, handler }
    }

    it('checks the password, hands the server over, then tells the cache: the owner is in its block', async () => {
        const { w, passwords, handler } = setUp(true)
        await handler.execute(new TransferOwnershipCommand('an', 'ot', 'binh', 'Harbour-Lantern-42'))

        expect(passwords.confirm).toHaveBeenCalledWith('an', 'Harbour-Lantern-42')
        expect(w.servers.changeMembership).toHaveBeenCalledWith('ot', 'an', 'binh', expect.any(Function))
        expect(w.written).toEqual([{ kind: 'transferOwnership', toUserId: 'binh' }])
        expect(w.log).toEqual(['password', 'commit', 'serverChanged ot'])
    })

    it('changes nothing on a wrong password', async () => {
        const { w, handler } = setUp(false)
        await expect(handler.execute(new TransferOwnershipCommand('an', 'ot', 'binh', 'nope'))).rejects.toThrow(
            'wrong password'
        )
        expect(w.servers.changeMembership).not.toHaveBeenCalled()
        expect(w.log).toEqual(['password'])
    })
})

describe('ForgetDeletedMemberHandler (D-76)', () => {
    it('takes a deleted member out of the server, then tells the cache, and says it changed something', async () => {
        const w = world(stateFor('binh'))
        await expect(
            new ForgetDeletedMemberHandler(w.servers, w.cache).execute(new ForgetDeletedMemberCommand('binh', 'ot'))
        ).resolves.toBe(true)
        expect(w.log).toEqual(['commit', 'memberChanged ot binh'])
    })

    it('deletes a server its deleted owner was alone in', async () => {
        const w = world(stateFor('an', { otherMembers: 0 }))
        await new ForgetDeletedMemberHandler(w.servers, w.cache).execute(new ForgetDeletedMemberCommand('an', 'ot'))
        expect(w.written).toEqual([{ kind: 'deleteServer' }])
        expect(w.log).toEqual(['commit', 'serverChanged ot'])
    })

    it('reports, and leaves as it is, a server its deleted owner shares with others', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
        const w = world(stateFor('an', { otherMembers: 2 }))
        await expect(
            new ForgetDeletedMemberHandler(w.servers, w.cache).execute(new ForgetDeletedMemberCommand('an', 'ot'))
        ).resolves.toBe(false)

        expect(w.written).toEqual([])
        expect(w.log).toEqual(['commit'])
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('still owns server ot'))
        warn.mockRestore()
    })
})

describe('CleanUpServersHandler', () => {
    const DELETED = [
        { serverId: 'old-1', iconKey: 'icons/old-1.webp' },
        { serverId: 'old-2', iconKey: null }
    ]

    function setUp(
        leftovers: { serverId: string; userId: string }[],
        outcomes: Record<string, boolean | Error> = {},
        queue: () => Promise<void> = async () => undefined,
        bansFail = false
    ) {
        const log: string[] = []
        const servers = {
            leftoverMemberships: jest.fn().mockResolvedValue(leftovers),
            forgetBansOfDeleted: jest.fn(async () => {
                log.push('forget bans')
                if (bansFail) throw new Error('database down')
            }),
            deletedBefore: jest.fn().mockResolvedValue(DELETED),
            purge: jest.fn(async (ids: string[]) => void log.push(`purge ${ids.join(',')}`))
        }
        const cleanup = {
            deleteFileLater: jest.fn(async (key: string) => {
                await queue()
                log.push(`queue ${key}`)
            })
        }
        const commandBus = {
            execute: jest.fn(async (command: ForgetDeletedMemberCommand) => {
                const outcome = outcomes[command.serverId] ?? true
                if (outcome instanceof Error) throw outcome
                return outcome
            })
        }
        const handler = new CleanUpServersHandler(
            servers as unknown as ServerRepositoryPort,
            cleanup as unknown as FileCleanupPort,
            commandBus as unknown as CommandBus
        )
        return { log, servers, commandBus, handler }
    }

    let error: jest.SpyInstance
    beforeEach(() => {
        error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    })
    afterEach(() => error.mockRestore())

    it('finishes what a lost event left, then deletes for good the servers deleted 30 days ago', async () => {
        const { log, servers, commandBus, handler } = setUp([{ serverId: 'ot', userId: 'binh' }])

        await expect(handler.execute(new CleanUpServersCommand(NOW))).resolves.toEqual({ forgotten: 1, purged: 2 })
        expect(commandBus.execute).toHaveBeenCalledWith(new ForgetDeletedMemberCommand('binh', 'ot'))
        expect(servers.deletedBefore).toHaveBeenCalledWith(purgeDeletedBefore(NOW), expect.any(Number))
        expect(purgeDeletedBefore(NOW)).toEqual(new Date('2026-10-12T09:00:00Z'))
        // The bans of deleted accounts (D-162); icons queued before the rows: the row is the only record of the key.
        expect(log).toEqual(['forget bans', 'queue icons/old-1.webp', 'purge old-1,old-2'])
    })

    it('deletes no server whose icon could not be queued: the next run tries again', async () => {
        const { log, handler } = setUp([], {}, async () => {
            throw new Error('queue unreachable')
        })
        await expect(handler.execute(new CleanUpServersCommand(NOW))).rejects.toThrow('queue unreachable')
        expect(log).toEqual(['forget bans'])
    })

    it('counts only the leftovers it changed', async () => {
        const { handler } = setUp(
            [
                { serverId: 'ot', userId: 'binh' },
                { serverId: 'kept', userId: 'an' }
            ],
            { kept: false }
        )
        await expect(handler.execute(new CleanUpServersCommand(NOW))).resolves.toEqual({ forgotten: 1, purged: 2 })
    })

    it('goes on quietly past a server deleted meanwhile', async () => {
        const { handler } = setUp(
            [
                { serverId: 'gone', userId: 'binh' },
                { serverId: 'ot', userId: 'binh' }
            ],
            { gone: new ServerNotFoundError('gone') }
        )
        await expect(handler.execute(new CleanUpServersCommand(NOW))).resolves.toEqual({ forgotten: 1, purged: 2 })
        expect(error).not.toHaveBeenCalled()
    })

    it('still deletes the servers due when the bans of deleted accounts cannot be forgotten', async () => {
        const { log, handler } = setUp([], {}, async () => undefined, true)
        await expect(handler.execute(new CleanUpServersCommand(NOW))).resolves.toEqual({ forgotten: 0, purged: 2 })
        expect(log).toEqual(['forget bans', 'queue icons/old-1.webp', 'purge old-1,old-2'])
        expect(error).toHaveBeenCalledTimes(1)
    })

    it('logs any other failure and goes on', async () => {
        const { handler } = setUp(
            [
                { serverId: 'broken', userId: 'binh' },
                { serverId: 'ot', userId: 'binh' }
            ],
            { broken: new Error('database down') }
        )
        await expect(handler.execute(new CleanUpServersCommand(NOW))).resolves.toEqual({ forgotten: 1, purged: 2 })
        expect(error).toHaveBeenCalledTimes(1)
    })
})

describe('ForgetDeletedAccountHandler (AccountDeletedEvent, D-76)', () => {
    it('runs one command per server they were in, and goes on past one that fails', async () => {
        const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const servers = {
            serverIdsOf: jest.fn().mockResolvedValue(['broken', 'ot']),
            forgetBansOf: jest.fn().mockResolvedValue(undefined)
        }
        const commandBus = {
            execute: jest.fn(async (command: ForgetDeletedMemberCommand) => {
                if (command.serverId === 'broken') throw new Error('database down')
            })
        }
        const handler = new ForgetDeletedAccountHandler(
            servers as unknown as ServerRepositoryPort,
            commandBus as unknown as CommandBus
        )

        await handler.handle(new AccountDeletedEvent('binh', true))

        expect(commandBus.execute.mock.calls.map(([command]) => command)).toEqual([
            new ForgetDeletedMemberCommand('binh', 'broken'),
            new ForgetDeletedMemberCommand('binh', 'ot')
        ])
        // Then the bans held against them (D-162).
        expect(servers.forgetBansOf).toHaveBeenCalledWith('binh')
        expect(error).toHaveBeenCalledTimes(1)
        error.mockRestore()
    })

    it('logs bans it could not forget, for the daily clean-up to finish', async () => {
        const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const servers = {
            serverIdsOf: jest.fn().mockResolvedValue([]),
            forgetBansOf: jest.fn().mockRejectedValue(new Error('database down'))
        }
        const handler = new ForgetDeletedAccountHandler(
            servers as unknown as ServerRepositoryPort,
            { execute: jest.fn() } as unknown as CommandBus
        )

        await expect(handler.handle(new AccountDeletedEvent('binh', true))).resolves.toBeUndefined()
        expect(error).toHaveBeenCalledTimes(1)
        error.mockRestore()
    })
})
