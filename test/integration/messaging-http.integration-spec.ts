import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Sending and reading messages through the whole app (REQ-MSG-01, REQ-MSG-10,
 * SRS 5.1): who may read and post, the nonce that makes a retry harmless, the
 * limits per person, history pages, and `message.created` to the channel.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Messages (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-msg-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi' | 'dung' | 'khanh'

    let app: NestExpressApplication
    let prisma: PrismaService
    let socketUrl: string
    const users = {} as Record<Who, { token: string; id: string }>
    const opened: Socket[] = []
    let serverId: string
    let generalId: string
    let secretId: string
    let voiceId: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]

    const send = (who: Who, channelId: string, content: string, nonce: string = randomUUID()) =>
        as(who, api().post(`/api/v1/channels/${channelId}/messages`))
            .set('Idempotency-Key', randomUUID())
            .send({ content, nonce })
    const history = (who: Who, channelId: string, query = '') =>
        as(who, api().get(`/api/v1/channels/${channelId}/messages${query}`))

    async function signUp(who: Who) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, PASSWORD)
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id }
    }

    /** A socket of `who`, connected and put in its rooms. */
    async function connectAs(who: Who): Promise<Socket> {
        const res = await as(who, api().post('/api/v1/realtime/ticket'))
        const socket = io(socketUrl, {
            auth: { ticket: res.body.data.ticket },
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
            extraHeaders: { Origin: FRONTEND }
        })
        opened.push(socket)
        await new Promise((resolve) => socket.once('ready', resolve))
        return socket
    }

    /** Every `event` the socket hears within a short wait. */
    function collect(socket: Socket, event: string): () => Promise<unknown[]> {
        const heard: unknown[] = []
        socket.on(event, (data: unknown) => heard.push(data))
        return () => new Promise((resolve) => setTimeout(() => resolve(heard), 400))
    }

    /** `count` messages of `who` straight into the database, a few milliseconds apart so their ids keep that order. */
    async function seed(who: Who, channelId: string, count: number): Promise<string[]> {
        const ids: string[] = []
        for (let i = 0; i < count; i++) {
            const row = await prisma.message.create({
                data: { channelId, authorId: users[who].id, content: `Tin ${i + 1}`, nonce: randomUUID() },
                select: { id: true }
            })
            ids.push(row.id)
            await new Promise((resolve) => setTimeout(resolve, 3))
        }
        return ids
    }

    beforeAll(async () => {
        app = await bootApp()
        await app.listen(0)
        socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi', 'dung', 'khanh'] as Who[]) await signUp(who)

        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'standard' })
        serverId = created.body.data.id
        const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        for (const who of ['binh', 'chi', 'dung'] as Who[]) {
            await as(who, api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
        }
        const secret = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
            .set('Idempotency-Key', randomUUID())
            .send({ type: 'text', name: 'ban-can-su', is_private: true, view_role_ids: [] })
        secretId = secret.body.data.id
        const channels = await prisma.channel.findMany({
            where: { serverId },
            select: { id: true, name: true, type: true }
        })
        generalId = channels.find((channel) => channel.type === 'text' && channel.name !== 'ban-can-su')!.id
        voiceId = channels.find((channel) => channel.type === 'voice')!.id
    })

    afterEach(() => {
        for (const socket of opened.splice(0)) socket.disconnect()
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.message.deleteMany({ where: { authorId: { in: ids } } }).catch(() => undefined)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    describe('sending (REQ-MSG-01)', () => {
        it('saves the text without the blank around it, and tells the channel, the nonce included', async () => {
            const watching = collect(await connectAs('an'), 'message.created')
            const nonce = randomUUID()

            const res = await send('binh', generalId, '  Mọi người ơi, câu 3 giải thế nào?\n ', nonce)

            expect(res.status).toBe(201)
            expect(res.body.data).toMatchObject({
                channel_id: generalId,
                type: 'regular',
                content: 'Mọi người ơi, câu 3 giải thế nào?',
                author: { id: users.binh.id, avatar_url: null },
                edited_at: null
            })
            const heard = (await watching()) as { message: { id: string; channel_id: string }; nonce: string }[]
            expect(heard).toHaveLength(1)
            expect(heard[0]).toMatchObject({ nonce, message: { id: res.body.data.id, channel_id: generalId } })
        })

        it('answers the same nonce with the same message, saved once and told once', async () => {
            const nonce = randomUUID()
            const first = await send('binh', generalId, 'Gửi lại khi mất mạng', nonce)
            const watching = collect(await connectAs('an'), 'message.created')

            const again = await send('binh', generalId, 'Gửi lại khi mất mạng', nonce)
            const third = await send('binh', generalId, 'Gửi lại khi mất mạng', nonce)

            expect([again.status, again.body.data.id, third.body.data.id]).toEqual([
                201,
                first.body.data.id,
                first.body.data.id
            ])
            expect(await prisma.message.count({ where: { authorId: users.binh.id, nonce } })).toBe(1)
            expect(await watching()).toHaveLength(0)
        })

        it('refuses a nonce already used in another channel, giving nothing of that message', async () => {
            const nonce = randomUUID()
            expect((await send('an', secretId, 'Họp cán sự', nonce)).status).toBe(201)

            const res = await send('an', generalId, 'Họp cán sự', nonce)

            expect(outcome(res)).toEqual([409, 'CONFLICT_ERROR'])
            expect(JSON.stringify(res.body.data ?? {})).not.toContain('Họp cán sự')
        })

        it('counts an emoji as one character: 2000 pass, 2001 do not', async () => {
            expect((await send('dung', generalId, '😀'.repeat(2000))).status).toBe(201)
            expect(outcome(await send('dung', generalId, 'a'.repeat(2001)))).toEqual([422, 'VALIDATION_ERROR'])
        })

        it('keeps the text composed, a letter typed with its accents apart counting as one', async () => {
            const res = await send('dung', generalId, 'e\u0301'.repeat(2000))
            expect(res.status).toBe(201)
            expect(res.body.data.content).toBe('é'.repeat(2000))
        })

        it('counts what is kept: blank lines after 2000 characters do not count', async () => {
            expect((await send('dung', generalId, `${'b'.repeat(2000)}\n\n  `)).status).toBe(201)
        })

        it('makes one message and one event when two sends of a nonce race', async () => {
            const watching = collect(await connectAs('an'), 'message.created')
            const nonce = randomUUID()

            // Two keys, so idempotency lets both through: only the nonce stops the second.
            const [first, second] = await Promise.all([
                send('binh', generalId, 'Đua nhau', nonce),
                send('binh', generalId, 'Đua nhau', nonce)
            ])

            expect([first.status, second.status]).toEqual([201, 201])
            expect(second.body.data.id).toBe(first.body.data.id)
            expect(await prisma.message.count({ where: { authorId: users.binh.id, nonce } })).toBe(1)
            expect(await watching()).toHaveLength(1)
        })

        it('refuses a message of nothing but spaces and blank lines', async () => {
            expect(outcome(await send('dung', generalId, ' \n\t '))).toEqual([422, 'VALIDATION_ERROR'])
        })

        it('needs a nonce', async () => {
            const res = await as('dung', api().post(`/api/v1/channels/${generalId}/messages`))
                .set('Idempotency-Key', randomUUID())
                .send({ content: 'Thiếu nonce' })
            expect(outcome(res)).toEqual([422, 'VALIDATION_ERROR'])
        })
    })

    describe('who may read and post (REQ-ROLE-03, REQ-ROLE-04, NFR-SEC-05)', () => {
        it('answers not found for a channel one may not view, a voice room, an unknown id, or a stranger', async () => {
            expect(outcome(await send('binh', secretId, 'Xin chào'))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await history('binh', secretId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await send('binh', voiceId, 'Xin chào'))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await history('binh', randomUUID()))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await history('khanh', generalId))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('lets the owner post in a private channel', async () => {
            expect((await send('an', secretId, 'Họp cán sự tối nay')).status).toBe(201)
        })

        it('refuses a channel for managers only, but lets the owner post there', async () => {
            const announcements = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name: 'thong-bao' })
            const id: string = announcements.body.data.id
            const changed = await as('an', api().patch(`/api/v1/servers/${serverId}/channels/${id}`)).send({
                send_mode: 'managers'
            })
            expect(changed.status).toBe(200)

            expect(outcome(await send('chi', id, 'Cho mình hỏi'))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect((await history('chi', id)).status).toBe(200)
            expect((await send('an', id, 'Lịch thi giữa kỳ')).status).toBe(201)
        })

        it('refuses a timed-out member, saying until when, who still reads', async () => {
            const res = await as('an', api().patch(`/api/v1/servers/${serverId}/members/${users.dung.id}`)).send({
                timeout_seconds: 60,
                reason: 'Spam'
            })
            expect(res.status).toBe(200)

            const refused = await send('dung', generalId, 'Mình bị khóa à?')

            expect(outcome(refused)).toEqual([403, 'MEMBER_TIMED_OUT'])
            const until = Date.parse(refused.body.data.timeout_until as string)
            expect(until).toBeGreaterThan(Date.now() + 50_000)
            expect((await history('dung', generalId)).status).toBe(200)
        })
    })

    describe('limits (REQ-MSG-10)', () => {
        it('refuse the 6th message in 5 seconds, with the wait, while others in the channel still send', async () => {
            for (let i = 1; i <= 5; i++) expect((await send('chi', generalId, `Tin ${i}`)).status).toBe(201)

            const sixth = await send('chi', generalId, 'Tin 6')

            expect(outcome(sixth)).toEqual([429, 'RATE_LIMIT_EXCEEDED'])
            expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0)
            expect(Number(sixth.headers['retry-after'])).toBeLessThanOrEqual(5)
            expect((await send('an', generalId, 'Chậm lại chút nhé')).status).toBe(201)
        })
    })

    describe('history (SRS 5.1, D-48)', () => {
        let channelId: string
        let ids: string[]

        beforeAll(async () => {
            const created = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name: 'lich-su' })
            channelId = created.body.data.id
            ids = await seed('binh', channelId, 7)
        })

        const page = async (query: string) => {
            const res = await history('chi', channelId, query)
            expect(res.status).toBe(200)
            const data = res.body.data as { items: { id: string }[]; has_more_before: boolean; has_more_after: boolean }
            return { ids: data.items.map((item) => item.id), before: data.has_more_before, after: data.has_more_after }
        }

        it('gives the newest messages, oldest first, 50 at most by default', async () => {
            expect(await page('')).toEqual({ ids, before: false, after: false })
            expect(await page('?limit=3')).toEqual({ ids: ids.slice(4), before: true, after: false })
        })

        it('goes back with before, and forward with after', async () => {
            expect(await page(`?before=${ids[4]}&limit=3`)).toEqual({ ids: ids.slice(1, 4), before: true, after: true })
            expect(await page(`?before=${ids[1]}&limit=3`)).toEqual({
                ids: ids.slice(0, 1),
                before: false,
                after: true
            })
            expect(await page(`?after=${ids[2]}&limit=3`)).toEqual({ ids: ids.slice(3, 6), before: true, after: true })
            expect(await page(`?after=${ids[6]}`)).toEqual({ ids: [], before: true, after: false })
        })

        it('opens around a message, half before it', async () => {
            expect(await page(`?around=${ids[3]}&limit=4`)).toEqual({ ids: ids.slice(1, 5), before: true, after: true })
        })

        it('leaves out a deleted message, and gives a system message with whom it is about', async () => {
            const gone = await prisma.message.create({
                data: { channelId, authorId: users.binh.id, content: '', nonce: randomUUID(), deletedAt: new Date() },
                select: { id: true }
            })
            const joined = await prisma.message.create({
                data: { channelId, type: 'system', systemEvent: 'member_joined', systemData: { userId: users.chi.id } },
                select: { id: true }
            })

            const res = await history('chi', channelId, '?limit=2')

            const items = res.body.data.items as { id: string; type: string; system_data: unknown }[]
            expect(items.map((item) => item.id)).not.toContain(gone.id)
            expect(items.at(-1)).toMatchObject({
                id: joined.id,
                type: 'system',
                system_data: { user_id: users.chi.id }
            })
            await prisma.message.deleteMany({ where: { id: { in: [gone.id, joined.id] } } })
        })

        it('takes one starting point only, and 1-100 messages', async () => {
            expect(outcome(await history('chi', channelId, `?before=${ids[3]}&after=${ids[1]}`))).toEqual([
                422,
                'VALIDATION_ERROR'
            ])
            expect(outcome(await history('chi', channelId, '?limit=101'))).toEqual([422, 'VALIDATION_ERROR'])
            expect(outcome(await history('chi', channelId, '?limit=0'))).toEqual([422, 'VALIDATION_ERROR'])
        })
    })
})
