import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCachePort } from '@/modules/permissions'
import { ModerationState, ModerationWrite, ServerNotFoundError } from '../../../domain'
import { ModerationRepositoryPort } from '../../ports'
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
    const deps = [repository as unknown as ModerationRepositoryPort, cache as unknown as PermissionCachePort] as const
    return { written, repository, cache, deps }
}

describe('moderation handlers', () => {
    it('kicks, and clears the cached member so their access ends with the next request', async () => {
        const { written, repository, cache, deps } = setUp()
        await new KickMemberHandler(...deps).execute(new KickMemberCommand('an', 'ot', 'dung', 'Spam'))
        expect(repository.change).toHaveBeenCalledWith('ot', 'an', 'dung', expect.any(Function))
        expect(written).toEqual([{ kind: 'kick', userId: 'dung' }])
        expect(cache.memberChanged).toHaveBeenCalledWith('ot', 'dung')
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })

    it('bans and times out, clearing the cached member each time', async () => {
        const banned = setUp()
        await new BanMemberHandler(...banned.deps).execute(new BanMemberCommand('an', 'ot', 'dung', null))
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
        const { cache, deps } = setUp({ found: false })
        await expect(
            new KickMemberHandler(...deps).execute(new KickMemberCommand('an', 'ot', 'dung', null))
        ).rejects.toThrow(ServerNotFoundError)
        expect(cache.memberChanged).not.toHaveBeenCalled()
    })
})
