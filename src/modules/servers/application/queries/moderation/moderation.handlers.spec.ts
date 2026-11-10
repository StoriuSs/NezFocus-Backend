import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { MissingPermissionError } from '../../../domain'
import { ModerationRepositoryPort } from '../../ports'
import { ListBansHandler } from './moderation.handlers'
import { ListBansQuery } from './moderation.queries'

const roles = [
    { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.KICK_MEMBERS, position: 1, isEveryone: false }
]

describe('ListBansHandler', () => {
    const access = (userId: string, roleIds: string[] = []): ServerAccess => ({
        server: { ownerId: 'an', roles, channels: [] },
        member: { userId, roleIds, timeoutUntil: null }
    })
    const repository = {
        bans: jest.fn().mockResolvedValue({ items: [], total: 0 })
    } as unknown as ModerationRepositoryPort

    it('lists the bans for someone holding BAN_MEMBERS', async () => {
        const checker = { access: jest.fn().mockResolvedValue(access('an')) }
        const handler = new ListBansHandler(repository, checker as unknown as PermissionCheckerPort)
        await expect(handler.execute(new ListBansQuery('an', 'ot', 2, 10))).resolves.toEqual({ items: [], total: 0 })
        expect(repository.bans).toHaveBeenCalledWith('ot', 2, 10)
    })

    it('refuses someone who only kicks', async () => {
        const checker = { access: jest.fn().mockResolvedValue(access('binh', ['lead'])) }
        const handler = new ListBansHandler(repository, checker as unknown as PermissionCheckerPort)
        await expect(handler.execute(new ListBansQuery('binh', 'ot', 1, 50))).rejects.toThrow(MissingPermissionError)
    })
})
