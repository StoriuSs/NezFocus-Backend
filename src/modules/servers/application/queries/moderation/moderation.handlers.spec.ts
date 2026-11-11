import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { UserDirectoryPort } from '@/modules/users'
import { MissingPermissionError, ModerationRepositoryPort } from '../../../domain'
import { ListBansHandler } from './moderation.handlers'
import { ListBansQuery } from './moderation.queries'

const roles = [
    { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.KICK_MEMBERS, position: 1, isEveryone: false }
]

/** Picture keys as the storage would give them out. */
const pictures = {
    avatarUrl: jest.fn((key: string | null) => Promise.resolve(key && `https://files.example.test/${key}`))
} as unknown as UserDirectoryPort

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
        const handler = new ListBansHandler(repository, checker as unknown as PermissionCheckerPort, pictures)
        await expect(handler.execute(new ListBansQuery('an', 'ot', 2, 10))).resolves.toEqual({ items: [], total: 0 })
        expect(repository.bans).toHaveBeenCalledWith('ot', 2, 10)
    })

    it('refuses someone who only kicks', async () => {
        const checker = { access: jest.fn().mockResolvedValue(access('binh', ['lead'])) }
        const handler = new ListBansHandler(repository, checker as unknown as PermissionCheckerPort, pictures)
        await expect(handler.execute(new ListBansQuery('binh', 'ot', 1, 50))).rejects.toThrow(MissingPermissionError)
    })

    it('gives the pictures as addresses, and no one for a banner whose account is gone', async () => {
        const person = (userId: string, avatarUrl: string | null) => ({
            userId,
            username: userId,
            displayName: null,
            avatarUrl
        })
        const bans = {
            bans: jest.fn().mockResolvedValue({
                items: [
                    {
                        user: person('dung', 'avatars/dung.webp'),
                        reason: null,
                        createdAt: new Date(0),
                        bannedBy: person('an', 'avatars/an.webp')
                    },
                    { user: person('phong', null), reason: null, createdAt: new Date(0), bannedBy: null }
                ],
                total: 2
            })
        } as unknown as ModerationRepositoryPort
        const checker = { access: jest.fn().mockResolvedValue(access('an')) }
        const handler = new ListBansHandler(bans, checker as unknown as PermissionCheckerPort, pictures)

        const { items } = await handler.execute(new ListBansQuery('an', 'ot', 1, 50))
        expect(
            items.map((item) => [item.user.avatarUrl, item.bannedBy === null ? 'gone' : item.bannedBy.avatarUrl])
        ).toEqual([
            ['https://files.example.test/avatars/dung.webp', 'https://files.example.test/avatars/an.webp'],
            [null, 'gone']
        ])
    })
})
