import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { RedisClientType } from 'redis'
import { requestDayOf } from '@/modules/social/domain'
import { FRIEND_REQUESTS_PER_PERSON_DAY } from '@/modules/social/application'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Friends, blocks, direct messages and calls through the whole app (SRS 4.9,
 * ARCHITECTURE 9, D-237 to D-243). The tables of M6 L1, what the database
 * itself refuses, and a conversation's channel kept out of every read of a
 * server; friends and blocks (L2): requests, their inbox items, the pair's
 * lock, the day's 50, lookups and profiles. Conversations come with L3,
 * calls with L4.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then
 * `pnpm test:integration`.
 */
describe('Social (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-social-${randomUUID().slice(0, 8)}`
    type Who = 'an' | 'binh' | 'chi' | 'dung'

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
        for (const who of ['an', 'binh', 'chi', 'dung'] as Who[]) await signUp(who)
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
        await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } })
        await prisma.user.updateMany({ where: { id: { in: ids } }, data: { deletionRequestedAt: null } })
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
        it('never lists it with a server; its messages are its two people’s only, and it has no tasks', async () => {
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

            // Its two people read it through the channel routes (D-238, M6 L3);
            // anyone else, and the task board of a server, find no channel.
            expect((await as('an', api().get(`/api/v1/channels/${dmChannelId}/messages`))).status).toBe(200)
            for (const [who, path] of [
                ['chi', `channels/${dmChannelId}/messages`],
                ['an', `channels/${dmChannelId}/tasks`]
            ] as [Who, string][]) {
                const res = await as(who, api().get(`/api/v1/${path}`))
                expect([who, path, res.status, res.body.meta?.type]).toEqual([who, path, 404, 'NOT_FOUND_ERROR'])
            }
        })
    })

    describe('friends and blocks (M6 L2, D-237, D-242, D-243)', () => {
        const usernameOf = async (who: Who): Promise<string> =>
            (await prisma.user.findUniqueOrThrow({ where: { id: users[who].id }, select: { username: true } }))
                .username!
        const ask = async (from: Who, to: Who, note?: string) =>
            as(from, api().post('/api/v1/me/relationships'))
                .set('Idempotency-Key', randomUUID())
                .send({ username: await usernameOf(to), ...(note !== undefined && { note }) })
        const accept = (who: Who, other: Who) =>
            as(who, api().post(`/api/v1/me/relationships/${users[other].id}/accept`)).set(
                'Idempotency-Key',
                randomUUID()
            )
        const listOf = async (who: Who) =>
            (await as(who, api().get('/api/v1/me/relationships'))).body.data.relationships as {
                user: { id: string; username: string | null }
                type: string
                note: string | null
                presence: string | null
            }[]
        const inboxOf = async (who: Who) => (await as(who, api().get('/api/v1/me/notifications'))).body.data
        const typeIn = async (who: Who, other: Who) =>
            (await listOf(who)).find((entry) => entry.user.id === users[other].id)?.type ?? 'none'

        it('asks by username with a note only the one asked sees, and accepting makes friends and tells the asker', async () => {
            const asked = await ask('an', 'binh', '  Mình là An, nhóm ôn Giải tích  ')
            expect([asked.status, asked.body.data.type, asked.body.data.note, asked.body.data.user.id]).toEqual([
                200,
                'outgoing',
                null,
                users.binh.id
            ])
            expect((await listOf('binh')).map(({ type, note }) => [type, note])).toEqual([
                ['incoming', 'Mình là An, nhóm ôn Giải tích']
            ])
            const binhInbox = await inboxOf('binh')
            expect(
                binhInbox.items.map((item: { type: string; note: string; server_id: string }) => [
                    item.type,
                    item.note,
                    item.server_id
                ])
            ).toEqual([['friend_request', 'Mình là An, nhóm ôn Giải tích', null]])

            const accepted = await accept('binh', 'an')
            expect([accepted.status, accepted.body.data.type, accepted.body.data.presence]).toEqual([
                200,
                'friend',
                'offline'
            ])
            expect(await typeIn('an', 'binh')).toBe('friend')
            expect((await inboxOf('binh')).items).toEqual([])
            expect(
                (await inboxOf('an')).items.map((item: { type: string; actor: { id: string } }) => [
                    item.type,
                    item.actor.id
                ])
            ).toEqual([['friend_accepted', users.binh.id]])
            // Accepting again from another tab changes nothing.
            expect((await accept('binh', 'an')).body.data.type).toBe('friend')
        })

        it('makes friends of two who ask each other, the second ask accepting', async () => {
            await ask('an', 'binh')
            const back = await ask('binh', 'an')
            expect(back.body.data.type).toBe('friend')
            expect(await prisma.relationship.count({ where: pairOf('an', 'binh') })).toBe(1)
        })

        it('makes one friendship of two asking each other at once, from their profiles (the pair lock, D-242)', async () => {
            const [one, two] = await Promise.all([
                as('an', api().put(`/api/v1/me/relationships/${users.binh.id}`)),
                as('binh', api().put(`/api/v1/me/relationships/${users.an.id}`))
            ])
            expect([one.status, two.status]).toEqual([200, 200])
            expect([one.body.data.type, two.body.data.type].sort()).toEqual(['friend', 'outgoing'])
            expect(
                await prisma.relationship.findUniqueOrThrow({ where: { userLowId_userHighId: pairOf('an', 'binh') } })
            ).toMatchObject({
                status: 'accepted',
                note: null
            })
        })

        it('refuses what SRS SOCIAL-01 refuses, each with its code', async () => {
            await ask('an', 'binh')
            await ask('an', 'chi')
            await accept('chi', 'an')

            const again = await ask('an', 'binh')
            expect([again.status, again.body.meta.type, again.body.meta.code]).toEqual([
                409,
                'FRIEND_REQUEST_PENDING',
                '409920'
            ])
            const friends = await ask('an', 'chi')
            expect([friends.status, friends.body.meta.type, friends.body.meta.code]).toEqual([
                409,
                'ALREADY_FRIENDS',
                '409921'
            ])
            const self = await ask('an', 'an')
            expect([self.status, self.body.meta.type]).toEqual([404, 'NOT_FOUND_ERROR'])
            const long = await ask('an', 'dung', 'x'.repeat(151))
            expect([long.status, long.body.meta.type]).toEqual([422, 'VALIDATION_ERROR'])
            // From a profile, asking again changes nothing.
            const repeat = await as('an', api().put(`/api/v1/me/relationships/${users.binh.id}`))
            expect([repeat.status, repeat.body.data.type]).toEqual([200, 'outgoing'])
            // No request of theirs to accept: the invitation is no longer valid.
            const none = await accept('an', 'dung')
            expect([none.status, none.body.meta.type]).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('declines, cancels and unfriends through one route, taking request items off', async () => {
            await ask('an', 'binh')
            const cancelled = await as('an', api().delete(`/api/v1/me/relationships/${users.binh.id}`))
            expect([cancelled.status, cancelled.body.data.type]).toEqual([200, 'none'])
            expect((await inboxOf('binh')).items).toEqual([])
            expect(await typeIn('binh', 'an')).toBe('none')

            await ask('an', 'binh')
            await as('binh', api().delete(`/api/v1/me/relationships/${users.an.id}`))
            expect(await typeIn('an', 'binh')).toBe('none')

            await ask('an', 'binh')
            await accept('binh', 'an')
            await as('binh', api().delete(`/api/v1/me/relationships/${users.an.id}`))
            expect(await typeIn('an', 'binh')).toBe('none')
            // Nothing there: nothing changes.
            expect((await as('binh', api().delete(`/api/v1/me/relationships/${users.an.id}`))).status).toBe(200)
        })

        it('blocks: the friendship goes, neither can ask the other, the one blocked still finds the card (REQ-SOCIAL-03)', async () => {
            await ask('an', 'binh')
            await accept('binh', 'an')

            const blocked = await as('binh', api().put(`/api/v1/me/blocks/${users.an.id}`))
            expect([blocked.status, blocked.body.data.type]).toEqual([200, 'blocked'])
            expect(await typeIn('an', 'binh')).toBe('none')
            expect((await listOf('binh')).map(({ type }) => type)).toEqual(['blocked'])

            for (const [from, to] of [
                ['an', 'binh'],
                ['binh', 'an']
            ] as [Who, Who][]) {
                const refused = await ask(from, to)
                expect([from, refused.status, refused.body.meta.type, refused.body.meta.code]).toEqual([
                    from,
                    403,
                    'CANNOT_MESSAGE_USER',
                    '403920'
                ])
            }
            const card = await as(
                'an',
                api()
                    .get('/api/v1/users/lookup')
                    .query({ username: await usernameOf('binh') })
            )
            expect([card.status, card.body.data.relationship]).toEqual([200, 'none'])

            const unblocked = await as('binh', api().delete(`/api/v1/me/blocks/${users.an.id}`))
            expect([unblocked.status, unblocked.body.data.type]).toEqual([200, 'none'])
            expect((await ask('an', 'binh')).status).toBe(200)
        })

        it('hides the items of someone blocked, the unread count with them, and shows them again once unblocked', async () => {
            await ask('an', 'binh')
            await accept('binh', 'an')
            // A moderation item, which names no one, stays whatever is blocked.
            const server = await prisma.server.create({ data: { name: 'Nhóm Giải tích', ownerId: users.chi.id } })
            await prisma.notification.create({
                data: {
                    userId: users.an.id,
                    type: 'moderation',
                    serverId: server.id,
                    data: { serverName: 'Nhóm Giải tích', action: 'kick' }
                }
            })
            // A server handed over by the one blocked stays too: it is about An's own role (L2-d).
            await prisma.member.create({ data: { serverId: server.id, userId: users.an.id } })
            await prisma.notification.create({
                data: {
                    userId: users.an.id,
                    type: 'owner_transferred',
                    serverId: server.id,
                    actorId: users.binh.id,
                    data: { serverName: 'Nhóm Giải tích' }
                }
            })
            expect((await inboxOf('an')).unread_count).toBe(3)

            await as('an', api().put(`/api/v1/me/blocks/${users.binh.id}`))
            const hidden = await inboxOf('an')
            expect([hidden.items.map((item: { type: string }) => item.type), hidden.unread_count]).toEqual([
                ['owner_transferred', 'moderation'],
                2
            ])

            await as('an', api().delete(`/api/v1/me/blocks/${users.binh.id}`))
            expect((await inboxOf('an')).unread_count).toBe(3)
        })

        it('looks up by username, at most 30 a minute (D-110)', async () => {
            const name = await usernameOf('chi')
            for (let lookup = 1; lookup <= 30; lookup++) {
                const res = await as(
                    'dung',
                    api()
                        .get('/api/v1/users/lookup')
                        .query({ username: `@${name.toUpperCase()}` })
                )
                expect([lookup, res.status]).toEqual([lookup, 200])
            }
            const refused = await as('dung', api().get('/api/v1/users/lookup').query({ username: name }))
            expect([refused.status, refused.body.meta.type, refused.body.data?.reason]).toEqual([
                429,
                'RATE_LIMIT_EXCEEDED',
                'user_lookup'
            ])
            expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
        })

        it('stops the 51st request of the day, until the sender midnight', async () => {
            const redis = app.get<RedisClientType>(REDIS_CLIENT)
            const subject = `${users.chi.id}:${requestDayOf(new Date(), 'Asia/Ho_Chi_Minh')}`
            const key = RateLimiter.key(FRIEND_REQUESTS_PER_PERSON_DAY, subject)
            await redis.set(key, String(FRIEND_REQUESTS_PER_PERSON_DAY.limit), { PX: 60_000 })
            try {
                const refused = await ask('chi', 'dung')
                expect([refused.status, refused.body.data?.reason]).toEqual([429, 'friend_requests'])
                const wait = Number(refused.headers['retry-after'])
                expect(wait).toBeGreaterThan(0)
                expect(wait).toBeLessThanOrEqual(24 * 60 * 60)
                // Answering a request is not a new one. Dũng asks from a profile:
                // Dũng's lookups of the minute went on the test before.
                await as('dung', api().put(`/api/v1/me/relationships/${users.chi.id}`))
                expect((await ask('chi', 'dung')).body.data.type).toBe('friend')
            } finally {
                await redis.del(key)
            }
        })

        it('gives a profile with the servers we share, in the order I joined them (D-109)', async () => {
            const first = await prisma.server.create({ data: { name: 'Ôn thi Giải tích 2', ownerId: users.an.id } })
            const second = await prisma.server.create({ data: { name: 'Nhóm đồ án Mobile', ownerId: users.an.id } })
            const mine = await prisma.server.create({ data: { name: 'Chỉ mình An', ownerId: users.an.id } })
            await prisma.member.createMany({
                data: [
                    { serverId: second.id, userId: users.an.id, joinedAt: new Date('2026-11-01T00:00:00Z') },
                    { serverId: first.id, userId: users.an.id, joinedAt: new Date('2026-11-02T00:00:00Z') },
                    { serverId: mine.id, userId: users.an.id },
                    { serverId: first.id, userId: users.binh.id },
                    { serverId: second.id, userId: users.binh.id }
                ]
            })

            const profile = await as('an', api().get(`/api/v1/users/${users.binh.id}/profile`))
            expect(profile.status).toBe(200)
            expect(profile.body.data).toMatchObject({
                relationship: 'none',
                presence: 'offline',
                mutual_servers: [
                    { id: second.id, name: 'Nhóm đồ án Mobile' },
                    { id: first.id, name: 'Ôn thi Giải tích 2' }
                ]
            })
            const stranger = await as('an', api().get(`/api/v1/users/${users.dung.id}/profile`))
            expect([stranger.body.data.presence, stranger.body.data.mutual_servers]).toEqual([null, []])
        })

        it('keeps the friends of an account waiting to be deleted, shown as deleted, and asks it nothing (D-243)', async () => {
            await ask('an', 'binh')
            await accept('binh', 'an')
            await prisma.user.update({ where: { id: users.binh.id }, data: { deletionRequestedAt: new Date() } })

            const friend = (await listOf('an')).find((entry) => entry.user.id === users.binh.id)
            expect(friend).toMatchObject({ type: 'friend', user: { username: null } })
            const blocked = await as('an', api().put(`/api/v1/me/blocks/${users.binh.id}`))
            expect([blocked.status, blocked.body.meta.type]).toEqual([404, 'NOT_FOUND_ERROR'])
            const removed = await as('an', api().delete(`/api/v1/me/relationships/${users.binh.id}`))
            expect([removed.status, removed.body.data.type]).toEqual([200, 'none'])
        })
    })
})
