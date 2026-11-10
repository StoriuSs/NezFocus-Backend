import { EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import {
    InviteInvalidError,
    InviteRecord,
    InviteRepositoryPort,
    JoinFacts,
    MissingPermissionError,
    ServerNotFoundError
} from '../../../domain'
import { GuessLimitPort, SystemMessagesPort } from '../../ports'
import { AcceptInviteHandler, CreateInviteHandler, RevokeInviteHandler } from './invite.handlers'
import { AcceptInviteCommand, CreateInviteCommand, RevokeInviteCommand } from './invite.commands'

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
        find: jest.fn(async () => null),
        delete: jest.fn(async () => true),
        join: jest.fn(),
        ...overrides
    }) as unknown as jest.Mocked<InviteRepositoryPort>

const limiter = () => {
    const state = { count: 0, limited: false, retryAfterSeconds: 42 }
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
