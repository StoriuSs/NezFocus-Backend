import { EventBus } from '@nestjs/cqrs'
import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCachePort } from '@/modules/permissions'
import { MemberChangedEvent } from '../../events/member-changed.event'
import { ServerChangedEvent } from '../../events/server-changed.event'
import { ModerationRepositoryPort, ModerationState, ModerationWrite, ServerNotFoundError } from '../../../domain'
import { BanMemberHandler, KickMemberHandler, TimeoutMemberHandler, UnbanMemberHandler } from './moderation.handlers'
import { BanMemberCommand, KickMemberCommand, TimeoutMemberCommand, UnbanMemberCommand } from './moderation.commands'

const roles = [
    { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.KICK_MEMBERS, position: 1, isEveryone: false }
]

const server = {
    id: 'ot',
    name: 'ÔT',
    iconKey: null,
    ownerId: 'an',
    welcomeChannelId: null,
    categories: [],
    channels: [],
    roles
}

/** The owner An acts on Dũng (no role), who is in ÔT, or on Khánh, who is banned from it. */
function setUp({ found = true, target = true, banned = false } = {}) {
    const written: ModerationWrite[] = []
    const repository = {
        change: jest.fn(
            async (_s: string, _u: string, targetId: string, decide: (s: ModerationState) => ModerationWrite[]) => {
                if (!found) return false
                const state: ModerationState = {
                    server,
                    member: { userId: 'an', roleIds: [], timeoutUntil: null },
                    target: target ? { userId: targetId, roleIds: [], timeoutUntil: null } : null,
                    banned
                }
                written.push(...decide(state))
                return true
            }
        )
    }
    const cache = {
        serverChanged: jest.fn().mockResolvedValue(undefined),
        memberChanged: jest.fn().mockResolvedValue(undefined)
    }
    const events = { publish: jest.fn() }
    const deps = [
        repository as unknown as ModerationRepositoryPort,
        cache as unknown as PermissionCachePort,
        events as unknown as EventBus
    ] as const
    const published = () => events.publish.mock.calls.map(([event]) => event as unknown)
    return { written, repository, cache, deps, published }
}

describe('moderation handlers', () => {
    it('kicks, and clears the cached member so their access ends with the next request', async () => {
        const { written, repository, cache, deps } = setUp()
        await new KickMemberHandler(...deps).execute(new KickMemberCommand('an', 'ot', 'dung', 'Spam'))
        expect(repository.change).toHaveBeenCalledWith('ot', 'an', 'dung', expect.any(Function))
        expect(written).toEqual([{ kind: 'kick', userId: 'dung', reason: 'Spam' }])
        expect(cache.memberChanged).toHaveBeenCalledWith('ot', 'dung')
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })

    it('bans and times out, clearing the cached member each time', async () => {
        const banned = setUp()
        await new BanMemberHandler(...banned.deps).execute(new BanMemberCommand('an', 'ot', 'dung', null, 0))
        expect(banned.cache.memberChanged).toHaveBeenCalledWith('ot', 'dung')

        const timedOut = setUp()
        await new TimeoutMemberHandler(...timedOut.deps).execute(new TimeoutMemberCommand('an', 'ot', 'dung', 60, null))
        expect(timedOut.written[0]).toMatchObject({ kind: 'timeOut', userId: 'dung' })
        expect(timedOut.cache.memberChanged).toHaveBeenCalledWith('ot', 'dung')
    })

    it('lifts a ban without touching the cache: they are in no server to forget', async () => {
        const { written, cache, deps } = setUp({ target: false, banned: true })
        await new UnbanMemberHandler(...deps).execute(new UnbanMemberCommand('an', 'ot', 'khanh'))
        expect(written).toEqual([{ kind: 'unban', userId: 'khanh' }])
        expect(cache.memberChanged).not.toHaveBeenCalled()
    })

    it('tells the cache nothing when ending a timeout that does not run', async () => {
        const { cache, deps } = setUp()
        await new TimeoutMemberHandler(...deps).execute(new TimeoutMemberCommand('an', 'ot', 'dung', null, null))
        expect(cache.memberChanged).not.toHaveBeenCalled()
    })

    it('answers NOT_FOUND when the server is gone or they are not in it', async () => {
        const { cache, deps, published } = setUp({ found: false })
        await expect(
            new KickMemberHandler(...deps).execute(new KickMemberCommand('an', 'ot', 'dung', null))
        ).rejects.toThrow(ServerNotFoundError)
        expect(cache.memberChanged).not.toHaveBeenCalled()
        expect(published()).toEqual([])
    })

    describe('tells the server after the commit (D-178)', () => {
        it('one kicked or banned leaves, with who removed them and why, for their own tabs alone', async () => {
            const kicked = setUp()
            await new KickMemberHandler(...kicked.deps).execute(new KickMemberCommand('an', 'ot', 'dung', 'Spam'))
            expect(kicked.published()).toEqual([new MemberChangedEvent('ot', 'dung', 'left', 'kick', 'Spam')])

            const banned = setUp()
            await new BanMemberHandler(...banned.deps).execute(new BanMemberCommand('an', 'ot', 'dung', null, 0))
            expect(banned.published()).toEqual([new MemberChangedEvent('ot', 'dung', 'left', 'ban', null)])
        })

        it('a ban that deletes their recent messages says which, up to the ban (D-181)', async () => {
            const banned = setUp()
            const before = Date.now()
            await new BanMemberHandler(...banned.deps).execute(new BanMemberCommand('an', 'ot', 'dung', null, 7))
            const [event] = banned.published() as MemberChangedEvent[]
            const { from, to } = event.deleteMessages!
            expect(to.getTime()).toBeGreaterThanOrEqual(before)
            expect(to.getTime()).toBeLessThanOrEqual(Date.now())
            expect(to.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
        })

        it('one timed out is updated; a ban lifted is told to the ban list alone', async () => {
            const timedOut = setUp()
            await new TimeoutMemberHandler(...timedOut.deps).execute(
                new TimeoutMemberCommand('an', 'ot', 'dung', 60, 'Nói tục')
            )
            expect(timedOut.published()).toEqual([new MemberChangedEvent('ot', 'dung', 'updated')])

            const lifted = setUp({ target: false, banned: true })
            await new UnbanMemberHandler(...lifted.deps).execute(new UnbanMemberCommand('an', 'ot', 'khanh'))
            expect(lifted.published()).toEqual([
                new ServerChangedEvent('ot', [{ topic: 'ban', action: 'deleted' }], false)
            ])
        })

        it('nothing when a timeout that does not run is ended', async () => {
            const { deps, published } = setUp()
            await new TimeoutMemberHandler(...deps).execute(new TimeoutMemberCommand('an', 'ot', 'dung', null, null))
            expect(published()).toEqual([])
        })
    })
})
