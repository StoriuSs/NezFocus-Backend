import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { LimitsUnavailableError } from '@/shared/domain'
import {
    InviteGuessesLimitedError,
    InviteInvalidError,
    InviteRecord,
    JoinFacts,
    MissingPermissionError,
    ServerNotFoundError
} from '../../domain'
import {
    GuessLimitPort,
    IconStoragePort,
    InvitePreviewSnapshot,
    InviteRepositoryPort,
    SystemMessagesPort
} from '../ports'
import { countingGuesses, INVITE_GUESSES_PER_NETWORK } from './invite-guesses'
import {
    AcceptInviteHandler,
    CreateInviteHandler,
    ListInvitesHandler,
    PreviewInviteHandler,
    RevokeInviteHandler
} from './invite.handlers'
import {
    AcceptInviteCommand,
    CreateInviteCommand,
    ListInvitesQuery,
    PreviewInviteQuery,
    RevokeInviteCommand
} from './invite.messages'

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
function checker(members: Record<string, bigint[]>, everyone = EVERYONE_DEFAULT_PERMISSIONS): PermissionCheckerPort {
    return {
        access: jest.fn(async (_serverId: string, userId: string): Promise<ServerAccess | null> => {
            const extra = members[userId]
            if (!extra) return null
            return {
                server: {
                    ownerId: 'an',
                    roles: [
                        { id: 'e', permissions: everyone, position: 0, isEveryone: true },
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
        insert: jest.fn(async () => true),
        latestOwnUnlimited: jest.fn(async () => null),
        listLive: jest.fn(async () => []),
        preview: jest.fn(async () => null),
        find: jest.fn(async () => null),
        delete: jest.fn(async () => true),
        join: jest.fn(),
        ...overrides
    }) as unknown as jest.Mocked<InviteRepositoryPort>

const limiter = (limited = false) => {
    const state = { count: limited ? 30 : 0, limited, retryAfterSeconds: 42 }
    return {
        check: jest.fn(async () => state),
        hit: jest.fn(async () => ({ ...state, count: state.count + 1 }))
    } as unknown as jest.Mocked<GuessLimitPort>
}

describe('CreateInviteHandler', () => {
    const members = { an: [], phong: [], khanh: [] as bigint[] }

    it('hands out their own unlimited link again when it may be (D-151)', async () => {
        const own = record()
        const invites = repository({ latestOwnUnlimited: jest.fn(async () => own) })
        const handler = new CreateInviteHandler(invites, checker(members))
        const result = await handler.execute(
            new CreateInviteCommand('an', 'ot', { maxAgeSeconds: 7 * DAY, maxUses: null })
        )
        expect(result).toBe(own)
        expect(invites.latestOwnUnlimited).toHaveBeenCalledWith('ot', 'an', 7 * DAY)
        expect(invites.insert).not.toHaveBeenCalled()
    })

    it('makes a new link with its expiry when none may be handed out again', async () => {
        const stale = record({ expiresAt: new Date(Date.now() + DAY * 1000) })
        const invites = repository({ latestOwnUnlimited: jest.fn(async () => stale) })
        const handler = new CreateInviteHandler(invites, checker(members))
        const before = Date.now()
        const result = await handler.execute(new CreateInviteCommand('an', 'ot', { maxAgeSeconds: DAY, maxUses: null }))
        expect(result.code).not.toBe(stale.code)
        expect(result).toMatchObject({ serverId: 'ot', creatorId: 'an', maxAgeSeconds: DAY, maxUses: null, uses: 0 })
        expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + DAY * 1000)
    })

    it('never looks for a link to hand out again when uses are limited', async () => {
        const invites = repository()
        const handler = new CreateInviteHandler(invites, checker(members))
        const result = await handler.execute(new CreateInviteCommand('an', 'ot', { maxAgeSeconds: null, maxUses: 1 }))
        expect(invites.latestOwnUnlimited).not.toHaveBeenCalled()
        expect(result).toMatchObject({ maxUses: 1, expiresAt: null })
    })

    it('draws another code when one is taken, and gives up after three', async () => {
        const taken = repository({ insert: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) })
        const settings = { maxAgeSeconds: null, maxUses: 5 }
        await new CreateInviteHandler(taken, checker(members)).execute(new CreateInviteCommand('an', 'ot', settings))
        expect(taken.insert).toHaveBeenCalledTimes(2)

        const full = repository({ insert: jest.fn(async () => false) })
        await expect(
            new CreateInviteHandler(full, checker(members)).execute(new CreateInviteCommand('an', 'ot', settings))
        ).rejects.toThrow('No free invite code')
        expect(full.insert).toHaveBeenCalledTimes(3)
    })

    it('needs CREATE_INVITE, and says not found to someone outside the server', async () => {
        const closed = checker(members, EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CREATE_INVITE)
        const settings = { maxAgeSeconds: null, maxUses: null }
        await expect(
            new CreateInviteHandler(repository(), closed).execute(new CreateInviteCommand('phong', 'ot', settings))
        ).rejects.toBeInstanceOf(MissingPermissionError)
        await expect(
            new CreateInviteHandler(repository(), checker(members)).execute(
                new CreateInviteCommand('stranger', 'ot', settings)
            )
        ).rejects.toBeInstanceOf(ServerNotFoundError)
    })
})

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

describe('RevokeInviteHandler', () => {
    const members = { an: [], binh: [], tuan: [Permission.MANAGE_SERVER], phong: [] as bigint[] }
    const handler = (invites: InviteRepositoryPort) => new RevokeInviteHandler(invites, checker(members))
    const binhs = record({ creatorId: 'binh' })

    it('lets the creator or someone with MANAGE_SERVER revoke', async () => {
        for (const who of ['binh', 'tuan', 'an']) {
            const invites = repository({ find: jest.fn(async () => binhs) })
            await handler(invites).execute(new RevokeInviteCommand(who, 'k7Qm2xPa'))
            expect(invites.delete).toHaveBeenCalledWith('k7Qm2xPa')
        }
    })

    it('refuses another member, and answers someone outside as for a code that does not exist', async () => {
        const invites = repository({ find: jest.fn(async () => binhs) })
        await expect(handler(invites).execute(new RevokeInviteCommand('phong', 'k7Qm2xPa'))).rejects.toBeInstanceOf(
            MissingPermissionError
        )
        await expect(handler(invites).execute(new RevokeInviteCommand('stranger', 'k7Qm2xPa'))).rejects.toBeInstanceOf(
            InviteInvalidError
        )
        expect(invites.delete).not.toHaveBeenCalled()
    })

    it('says invalid for a link that is gone, used up, or removed meanwhile', async () => {
        for (const found of [null, record({ maxUses: 1, uses: 1 })]) {
            const invites = repository({ find: jest.fn(async () => found) })
            await expect(handler(invites).execute(new RevokeInviteCommand('an', 'k7Qm2xPa'))).rejects.toBeInstanceOf(
                InviteInvalidError
            )
        }
        const raced = repository({ find: jest.fn(async () => record()), delete: jest.fn(async () => false) })
        await expect(handler(raced).execute(new RevokeInviteCommand('an', 'k7Qm2xPa'))).rejects.toBeInstanceOf(
            InviteInvalidError
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

describe('AcceptInviteHandler', () => {
    const messages = () =>
        ({ memberJoined: jest.fn(async () => undefined) }) as unknown as jest.Mocked<SystemMessagesPort>

    it('joins by the rules of decideJoin and posts the welcome after the commit', async () => {
        const facts: JoinFacts = { invite: record(), isMember: false, isBanned: false, serverCount: 2 }
        const invites = repository({
            join: jest.fn(async (_code, _userId, decide) => ({ serverId: 'ot', decision: decide(facts, new Date()) }))
        })
        const posted = messages()
        const result = await new AcceptInviteHandler(invites, limiter(), posted).execute(
            new AcceptInviteCommand('binh', 'k7Qm2xPa', IP)
        )
        expect(result).toEqual({ serverId: 'ot', decision: 'join' })
        expect(invites.join).toHaveBeenCalledWith('k7Qm2xPa', 'binh', expect.any(Function))
        expect(posted.memberJoined).toHaveBeenCalledWith('ot', 'binh')
    })

    it('still answers joined when the welcome message fails', async () => {
        const invites = repository({ join: jest.fn(async () => ({ serverId: 'ot', decision: 'join' as const })) })
        const posted = messages()
        posted.memberJoined.mockRejectedValue(new Error('down'))
        await expect(
            new AcceptInviteHandler(invites, limiter(), posted).execute(new AcceptInviteCommand('binh', 'k7Qm2xPa', IP))
        ).resolves.toEqual({ serverId: 'ot', decision: 'join' })
    })

    it('posts nothing for a member coming back through a link', async () => {
        const invites = repository({
            join: jest.fn(async () => ({ serverId: 'ot', decision: 'already_member' as const }))
        })
        const posted = messages()
        await new AcceptInviteHandler(invites, limiter(), posted).execute(
            new AcceptInviteCommand('binh', 'k7Qm2xPa', IP)
        )
        expect(posted.memberJoined).not.toHaveBeenCalled()
    })

    it('refuses a malformed code without reading anything', async () => {
        const invites = repository()
        await expect(
            new AcceptInviteHandler(invites, limiter(), messages()).execute(new AcceptInviteCommand('binh', 'k7Q', IP))
        ).rejects.toBeInstanceOf(InviteInvalidError)
        expect(invites.join).not.toHaveBeenCalled()
    })
})

describe('countingGuesses', () => {
    it('refuses once the network has spent its 30 wrong codes, without running the lookup', async () => {
        const limit = limiter(true)
        const lookup = jest.fn()
        await expect(countingGuesses(limit, IP, lookup)).rejects.toEqual(new InviteGuessesLimitedError(42))
        expect(lookup).not.toHaveBeenCalled()
        expect(limit.check).toHaveBeenCalledWith(INVITE_GUESSES_PER_NETWORK, IP)
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('counts only an invalid code, after the lookup', async () => {
        const limit = limiter()
        await expect(countingGuesses(limit, IP, async () => 'ok')).resolves.toBe('ok')
        await expect(
            countingGuesses(limit, IP, async () => {
                throw new ServerNotFoundError('ot')
            })
        ).rejects.toBeInstanceOf(ServerNotFoundError)
        expect(limit.hit).not.toHaveBeenCalled()
        await expect(
            countingGuesses(limit, IP, async () => {
                throw new InviteInvalidError()
            })
        ).rejects.toBeInstanceOf(InviteInvalidError)
        expect(limit.hit).toHaveBeenCalledWith(INVITE_GUESSES_PER_NETWORK, IP)
    })

    it('lets lookups through uncounted while the counter is down', async () => {
        const limit = limiter()
        limit.check.mockRejectedValue(new LimitsUnavailableError())
        limit.hit.mockRejectedValue(new LimitsUnavailableError())
        await expect(countingGuesses(limit, IP, async () => 'ok')).resolves.toBe('ok')
        await expect(
            countingGuesses(limit, IP, async () => {
                throw new InviteInvalidError()
            })
        ).rejects.toBeInstanceOf(InviteInvalidError)
    })

    it('passes on any other failure of the counter', async () => {
        const limit = limiter()
        limit.check.mockRejectedValue(new Error('boom'))
        await expect(countingGuesses(limit, IP, async () => 'ok')).rejects.toThrow('boom')
    })
})
