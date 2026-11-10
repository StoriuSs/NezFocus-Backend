import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { InviteInvalidError, InviteRecord, MissingPermissionError } from '../../../domain'
import { GuessLimitPort, IconStoragePort, InvitePreviewSnapshot, InviteRepositoryPort } from '../../ports'
import { ListInvitesHandler, PreviewInviteHandler } from './invite.handlers'
import { ListInvitesQuery, PreviewInviteQuery } from './invite.queries'

const DAY = 24 * 60 * 60
const IP = '10.1.2.3'

const record = (extra: Partial<InviteRecord> = {}): InviteRecord => ({
    code: 'k7Qm2xPa',
    serverId: 'ot',
    creatorId: 'an',
    maxAgeSeconds: 7 * DAY,
    maxUses: null,
    uses: 0,
    expiresAt: new Date(Date.now() + 7 * DAY * 1000),
    createdAt: new Date(),
    ...extra
})

/** ÔT, owned by An; @everyone holds `everyone` (the defaults unless said). */
function checker(members: Record<string, bigint[]>): PermissionCheckerPort {
    return {
        access: jest.fn(async (_serverId: string, userId: string): Promise<ServerAccess | null> => {
            const extra = members[userId]
            if (!extra) return null
            return {
                server: {
                    ownerId: 'an',
                    roles: [
                        { id: 'e', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
                        ...extra.map((bits, i) => ({
                            id: `r${i}`,
                            permissions: bits,
                            position: i + 1,
                            isEveryone: false
                        }))
                    ],
                    channels: []
                },
                member: { userId, roleIds: extra.map((_, i) => `r${i}`), timeoutUntil: null }
            }
        })
    } as unknown as PermissionCheckerPort
}

const repository = (overrides: Partial<InviteRepositoryPort> = {}) =>
    ({
        listLive: jest.fn(async () => []),
        preview: jest.fn(async () => null),
        ...overrides
    }) as unknown as jest.Mocked<InviteRepositoryPort>

const limiter = () => {
    const state = { count: 0, limited: false, retryAfterSeconds: 42 }
    return {
        check: jest.fn(async () => state),
        hit: jest.fn(async () => ({ ...state, count: state.count + 1 }))
    } as unknown as jest.Mocked<GuessLimitPort>
}

describe('ListInvitesHandler', () => {
    it('lists for those with MANAGE_SERVER only', async () => {
        const invites = repository()
        const handler = new ListInvitesHandler(invites, checker({ tuan: [Permission.MANAGE_SERVER], phong: [] }))
        await handler.execute(new ListInvitesQuery('tuan', 'ot'))
        expect(invites.listLive).toHaveBeenCalledWith('ot', expect.any(Date))
        await expect(handler.execute(new ListInvitesQuery('phong', 'ot'))).rejects.toBeInstanceOf(
            MissingPermissionError
        )
    })
})

describe('PreviewInviteHandler', () => {
    const storage = {
        getReadUrl: jest.fn(async (key: string) => `https://cdn.test/${key}`)
    } as unknown as IconStoragePort
    const snapshot = (extra: Partial<InvitePreviewSnapshot> = {}): InvitePreviewSnapshot => ({
        invite: record(),
        server: {
            id: 'ot',
            name: 'Ôn thi Giải tích 2',
            iconKey: 'icons/ot.webp',
            ownerId: 'an',
            memberCount: 13,
            roles: [{ id: 'e', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }]
        },
        inviterName: 'An',
        channel: {
            id: 'hoi-dap',
            type: 'text',
            name: 'hoi-dap',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            isStudyRoom: false
        },
        ...extra
    })

    it('shows the server, the inviter and the target, and costs a good code nothing', async () => {
        const invites = repository({ preview: jest.fn(async () => snapshot()) })
        const limit = limiter()
        const result = await new PreviewInviteHandler(invites, storage, limit).execute(
            new PreviewInviteQuery('k7Qm2xPa', 'hoi-dap', IP)
        )
        expect(result).toEqual({
            code: 'k7Qm2xPa',
            server: {
                id: 'ot',
                name: 'Ôn thi Giải tích 2',
                iconUrl: 'https://cdn.test/icons/ot.webp',
                memberCount: 13
            },
            inviterName: 'An',
            channel: { id: 'hoi-dap', name: 'hoi-dap', type: 'text', isStudyRoom: false }
        })
        expect(invites.preview).toHaveBeenCalledWith('k7Qm2xPa', 'hoi-dap')
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('has no icon URL for a server without one', async () => {
        const plain = snapshot()
        const invites = repository({
            preview: jest.fn(async () => ({ ...plain, server: { ...plain.server, iconKey: null } }))
        })
        const result = await new PreviewInviteHandler(invites, storage, limiter()).execute(
            new PreviewInviteQuery('k7Qm2xPa', null, IP)
        )
        expect(result.server.iconUrl).toBeNull()
    })

    it('counts a malformed, unknown or used up code as a wrong one', async () => {
        const cases: [string, InvitePreviewSnapshot | null][] = [
            ['not-a-code', snapshot()],
            ['Zz9xxxxx', null],
            ['k7Qm2xPa', snapshot({ invite: record({ maxUses: 2, uses: 2 }) })]
        ]
        for (const [code, found] of cases) {
            const invites = repository({ preview: jest.fn(async () => found) })
            const limit = limiter()
            await expect(
                new PreviewInviteHandler(invites, storage, limit).execute(new PreviewInviteQuery(code, null, IP))
            ).rejects.toBeInstanceOf(InviteInvalidError)
            expect(limit.hit).toHaveBeenCalledTimes(1)
        }
    })
})
