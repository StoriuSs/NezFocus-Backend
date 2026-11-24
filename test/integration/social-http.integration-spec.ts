import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Friends, blocks, direct messages and calls through the whole app (SRS 4.9,
 * ARCHITECTURE 9, D-237 to D-242). So far the tables of M6 L1, what the
 * database itself refuses, and a conversation's channel kept out of every
 * read of a server; the rules come with L2 to L4.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then
 * `pnpm test:integration`.
 */
describe('Social (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-social-${randomUUID().slice(0, 8)}`
    type Who = 'an' | 'binh' | 'chi'

    let app: NestExpressApplication
    let prisma: PrismaService
    const users = {} as Record<Who, { id: string; token: string }>

    const api = () => request(app.getHttpServer())
    const as = (who: Who, req: request.Test) =>
        req.set('Authorization', `Bearer ${users[who].token}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }

    async function signUp(who: Who) {
        const { accessToken } = await signInWithCode(post, `${PREFIX}-${who}@example.test`)
        await completeAccount(post, accessToken, 'Harbour-Lantern-42')
        const me = await api()
            .get('/api/v1/users/me')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Forwarded-For', CLIENT_IP)
            .set('Origin', FRONTEND)
        users[who] = { id: me.body.data.id, token: accessToken }
    }

    /** The two people's ids, the smaller first, as social.prisma keeps a pair. */
    const pairOf = (a: Who, b: Who) => {
        const [low, high] = [users[a].id, users[b].id].sort()
        return { userLowId: low, userHighId: high }
    }

    /** Every channel the tests write, removed after each: some never get their DmChannel row. */
    const written: string[] = []

    /** A conversation of two, written straight to the tables: its channel, then its DmChannel row. */
    async function conversation(a: Who, b: Who): Promise<string> {
        const channel = await prisma.channel.create({
            data: { type: 'dm', name: '', nameKey: '', position: 0 },
            select: { id: true }
        })
        written.push(channel.id)
        await prisma.dmChannel.create({ data: { channelId: channel.id, ...pairOf(a, b) } })
        return channel.id
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi'] as Who[]) await signUp(who)
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.channel
            .deleteMany({ where: { dm: { OR: [{ userLowId: { in: ids } }, { userHighId: { in: ids } }] } } })
            .catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    afterEach(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma.notification.deleteMany({ where: { userId: { in: ids } } })
        await prisma.relationship.deleteMany({ where: { userLowId: { in: ids } } })
        await prisma.block.deleteMany({ where: { blockerId: { in: ids } } })
        // A conversation's channel takes its DmChannel, calls and messages with it.
        await prisma.channel.deleteMany({ where: { id: { in: written.splice(0) } } })
        await prisma.server.deleteMany({ where: { ownerId: { in: ids } } })
    })

    describe('constraints of the database (20261124100000_social)', () => {
        type DatabaseError = { meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } }
        /** The constraint that refused a write, as Postgres names it; "written" when none did. */
        const refusedBy = (write: Promise<unknown>): Promise<string> =>
            write.then(
                () => 'written',
                (error: DatabaseError) => {
                    const said = error.meta?.driverAdapterError?.cause?.originalMessage ?? String(error)
                    return /constraint "([^"]+)"/.exec(said)?.[1] ?? said
                }
            )
        const channel = (shape: Record<string, unknown>) =>
            prisma.channel
                .create({ data: { name: '', nameKey: '', position: 0, ...shape } as never, select: { id: true } })
                .then((row) => {
                    written.push(row.id)
                    return row
                })

        it('keeps a channel without a server to conversations, and a conversation free of what servers use', async () => {
            const server = await prisma.server.create({ data: { name: 'Nhóm Giải tích', ownerId: users.an.id } })
            const category = await prisma.category.create({
                data: { serverId: server.id, name: 'Phòng học', nameKey: 'phòng học', position: 0 }
            })

            expect(await refusedBy(channel({ type: 'dm' }))).toBe('written')
            // Every conversation has the same empty name: the unique index of
            // names is a server's only.
            expect(await refusedBy(channel({ type: 'dm' }))).toBe('written')
            expect(await refusedBy(channel({ type: 'text', name: 'chung', nameKey: 'chung' }))).toBe('Channel_dm_check')
            expect(await refusedBy(channel({ type: 'dm', serverId: server.id }))).toBe('Channel_dm_check')
            for (const wrong of [
                { categoryId: category.id },
                { name: 'an-binh' },
                { nameKey: 'an-binh' },
                { position: 1 },
                { isPrivate: true },
                { sendMode: 'managers' },
                { isStudyRoom: true },
                { taskBoardEnabled: true }
            ]) {
                expect([wrong, await refusedBy(channel({ type: 'dm', ...wrong }))]).toEqual([wrong, 'Channel_dm_check'])
            }

            // A server's names still clash within a group, "no category" included.
            const text = { type: 'text', serverId: server.id, name: 'chung', nameKey: 'chung' }
            expect(await refusedBy(channel(text))).toBe('written')
            expect(await refusedBy(channel(text))).toBe('Channel_serverId_categoryId_type_nameKey_key')
            expect(await refusedBy(channel({ ...text, type: 'voice' }))).toBe('written')
        })

        it('keeps one friendship row per pair, smaller id first, asked by one of the two', async () => {
            const pair = pairOf('an', 'binh')
            const write = (shape: Record<string, unknown>) =>
                prisma.relationship.create({ data: { ...pair, requesterId: users.an.id, ...shape } as never })

            expect(await refusedBy(write({ userLowId: pair.userHighId, userHighId: pair.userLowId }))).toBe(
                'Relationship_pair_check'
            )
            expect(await refusedBy(write({ userHighId: pair.userLowId }))).toBe('Relationship_pair_check')
            expect(await refusedBy(write({ requesterId: users.chi.id }))).toBe('Relationship_pair_check')
            expect(await refusedBy(write({ status: 'accepted' }))).toBe('Relationship_status_check')
            expect(await refusedBy(write({ acceptedAt: new Date() }))).toBe('Relationship_status_check')
            expect(
                await refusedBy(write({ status: 'accepted', acceptedAt: new Date(), note: 'Mình học cùng lớp' }))
            ).toBe('Relationship_status_check')

            expect(await refusedBy(write({ note: 'Mình học cùng lớp' }))).toBe('written')
            // Binh asking back is the same pair: one row, which the rules turn
            // into a friendship (L2), never a second request.
            expect(await refusedBy(write({ requesterId: users.binh.id }))).toBe('Relationship_pkey')
        })

        it('lets two people block each other, once each way, never themselves', async () => {
            const block = (by: Who, of: Who) =>
                prisma.block.create({ data: { blockerId: users[by].id, blockedId: users[of].id } })

            expect(await refusedBy(block('an', 'an'))).toBe('Block_pair_check')
            expect(await refusedBy(block('an', 'binh'))).toBe('written')
            expect(await refusedBy(block('binh', 'an'))).toBe('written')
            expect(await refusedBy(block('an', 'binh'))).toBe('Block_pkey')
        })

        it('keeps one conversation per pair, smaller id first', async () => {
            const dm = (pair: { userLowId: string; userHighId: string }) =>
                channel({ type: 'dm' }).then((row) => prisma.dmChannel.create({ data: { channelId: row.id, ...pair } }))
            const pair = pairOf('an', 'binh')

            expect(await refusedBy(dm({ userLowId: pair.userHighId, userHighId: pair.userLowId }))).toBe(
                'DmChannel_pair_check'
            )
            expect(await refusedBy(dm(pair))).toBe('written')
            expect(await refusedBy(dm(pair))).toBe('DmChannel_userLowId_userHighId_key')
            expect(await refusedBy(dm(pairOf('an', 'chi')))).toBe('written')
        })

        it('keeps one open call per conversation, and what each status has', async () => {
            const dmChannelId = await conversation('an', 'binh')
            const call = (shape: Record<string, unknown> = {}) =>
                prisma.call.create({
                    data: { dmChannelId, callerId: users.an.id, calleeId: users.binh.id, ...shape } as never
                })
            const answered = new Date(Date.now() - 60_000)
            const over = new Date()

            expect(await refusedBy(call({ calleeId: users.an.id }))).toBe('Call_status_check')
            for (const wrong of [
                { acceptedAt: answered },
                { endedAt: over },
                { endReason: 'no_answer' },
                { status: 'active' },
                { status: 'active', acceptedAt: answered, endedAt: over },
                { status: 'ended', acceptedAt: answered },
                { status: 'ended', endedAt: over },
                { status: 'failed', endedAt: over },
                { status: 'declined', acceptedAt: answered, endedAt: over },
                { status: 'missed', endedAt: over },
                { status: 'declined', endedAt: over, endReason: 'busy' }
            ]) {
                expect([wrong, await refusedBy(call(wrong))]).toEqual([wrong, 'Call_status_check'])
            }

            // Final calls are history, as many as there were.
            for (const final of [
                { status: 'ended', acceptedAt: answered, endedAt: over },
                { status: 'failed', acceptedAt: answered, endedAt: over },
                { status: 'declined', endedAt: over },
                { status: 'missed', endedAt: over, endReason: 'no_answer' },
                { status: 'missed', endedAt: over, endReason: 'cancelled' },
                { status: 'missed', endedAt: over, endReason: 'busy' }
            ]) {
                expect([final, await refusedBy(call(final))]).toEqual([final, 'written'])
            }
            expect(await refusedBy(call())).toBe('written')
            // Binh calling back while it rings meets the same call (D-242).
            expect(await refusedBy(call({ callerId: users.binh.id, calleeId: users.an.id }))).toBe(
                'Call_one_open_per_dm'
            )
            expect(
                await refusedBy(
                    prisma.call.updateMany({
                        where: { dmChannelId, status: 'ringing' },
                        data: { status: 'active', acceptedAt: answered }
                    })
                )
            ).toBe('written')
            expect(await refusedBy(call({ status: 'active', acceptedAt: answered }))).toBe('Call_one_open_per_dm')
            // Another conversation has its own.
            const other = await conversation('an', 'chi')
            expect(
                await refusedBy(
                    prisma.call.create({ data: { dmChannelId: other, callerId: users.chi.id, calleeId: users.an.id } })
                )
            ).toBe('written')
        })

        it("keeps M6's inbox items off servers: friends name who, a missed call its message", async () => {
            const server = await prisma.server.create({ data: { name: 'Nhóm Giải tích', ownerId: users.an.id } })
            const dmChannelId = await conversation('an', 'binh')
            const ended = await prisma.message.create({
                data: {
                    channelId: dmChannelId,
                    type: 'system',
                    systemEvent: 'call_ended',
                    systemData: { callId: randomUUID(), callerId: users.an.id, status: 'missed' }
                }
            })
            const item = (shape: Record<string, unknown>) =>
                prisma.notification.create({ data: { userId: users.binh.id, actorId: users.an.id, ...shape } as never })

            expect(await refusedBy(item({ type: 'friend_request', data: { note: 'Mình học cùng lớp' } }))).toBe(
                'written'
            )
            expect(await refusedBy(item({ type: 'friend_accepted' }))).toBe('written')
            expect(await refusedBy(item({ type: 'missed_call', channelId: dmChannelId, messageId: ended.id }))).toBe(
                'written'
            )

            for (const wrong of [
                { type: 'friend_request', actorId: null },
                { type: 'friend_request', serverId: server.id },
                { type: 'friend_accepted', channelId: dmChannelId, messageId: ended.id },
                { type: 'friend_accepted', channelId: dmChannelId },
                { type: 'friend_request', taskId: randomUUID() },
                { type: 'missed_call' },
                { type: 'missed_call', channelId: dmChannelId },
                { type: 'missed_call', channelId: dmChannelId, messageId: ended.id, taskId: randomUUID() },
                { type: 'missed_call', channelId: dmChannelId, messageId: ended.id, actorId: null },
                { type: 'missed_call', channelId: dmChannelId, messageId: ended.id, serverId: server.id },
                // The items of servers still need theirs.
                { type: 'mention', channelId: dmChannelId, messageId: ended.id },
                { type: 'owner_transferred' }
            ]) {
                expect([wrong, await refusedBy(item(wrong))]).toEqual([wrong, 'Notification_links_check'])
            }
        })
    })

    describe("a conversation's channel and the servers' reads", () => {
        it('never lists it with a server, and finds no channel there for messages or tasks', async () => {
            const created = await as('an', api().post('/api/v1/servers'))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Ôn thi Giải tích 2', template: 'study' })
            expect(created.status).toBe(201)
            const dmChannelId = await conversation('an', 'binh')

            const servers = await as('an', api().get('/api/v1/servers'))
            const channelIds = (servers.body.data.servers as { channels: { id: string }[] }[]).flatMap((server) =>
                server.channels.map((c) => c.id)
            )
            expect(channelIds.length).toBeGreaterThan(0)
            expect(channelIds).not.toContain(dmChannelId)

            // Until L3 opens conversations to messaging (D-238), a channel with
            // no server is no channel at all, even to its two people.
            for (const path of [`channels/${dmChannelId}/messages`, `channels/${dmChannelId}/tasks`]) {
                const res = await as('an', api().get(`/api/v1/${path}`))
                expect([path, res.status, res.body.meta?.type]).toEqual([path, 404, 'NOT_FOUND_ERROR'])
            }
        })
    })
})
