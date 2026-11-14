import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { MESSAGE_REPOSITORY, MessageRepositoryPort } from '@/modules/messaging/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/** An edit that mentions no one. */
const NO_MENTIONS = { everyone: false, roleIds: [], userIds: [] }

/**
 * Sending and reading messages through the whole app (REQ-MSG-01, REQ-MSG-05,
 * REQ-MSG-10, SRS 5.1): who may read and post, the nonce that makes a retry
 * harmless, the limits per person, history pages, editing, deleting and
 * replying, and the events the channel hears.
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
    const reply = (who: Who, channelId: string, content: string, replyToId: string) =>
        as(who, api().post(`/api/v1/channels/${channelId}/messages`))
            .set('Idempotency-Key', randomUUID())
            .send({ content, nonce: randomUUID(), reply_to_id: replyToId })
    const edit = (who: Who, messageId: string, content: string) =>
        as(who, api().patch(`/api/v1/messages/${messageId}`)).send({ content })
    const remove = (who: Who, messageId: string) => as(who, api().delete(`/api/v1/messages/${messageId}`))
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

    describe('mentions (REQ-MSG-03, D-164, D-171, D-172)', () => {
        let channelId: string
        /** "Trợ giảng" everyone may mention; "Ban tổ chức" only MENTION_EVERYONE may. */
        let helpersId: string
        let organisersId: string
        const mentionRows = async (messageId: string) =>
            (await prisma.messageMention.findMany({ where: { messageId }, select: { userId: true } }))
                .map((row) => row.userId)
                .sort()

        beforeAll(async () => {
            const made = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name: 'nhac-ten' })
            channelId = made.body.data.id
            const role = async (name: string, mentionable: boolean) => {
                const res = await as('an', api().post(`/api/v1/servers/${serverId}/roles`))
                    .set('Idempotency-Key', randomUUID())
                    .send({ name })
                const id: string = res.body.data.role_id
                await as('an', api().patch(`/api/v1/servers/${serverId}/roles/${id}`)).send({ mentionable })
                return id
            }
            helpersId = await role('Trợ giảng', true)
            organisersId = await role('Ban tổ chức', false)
        })

        it('keeps what the author may mention, names it in history and to the channel, and saves who it is about', async () => {
            const watching = collect(await connectAs('an'), 'message.created')
            const nobody = randomUUID()
            const text = `<@${users.chi.id}> <@${users.khanh.id}> <@${nobody}> <@&${helpersId}> <@&${organisersId}> @everyone ơi`

            const res = await send('binh', channelId, text)

            expect(res.status).toBe(201)
            expect(res.body.data).toMatchObject({
                content: `<@${users.chi.id}> <@${users.khanh.id}> <@${nobody}> <@&${helpersId}> @Ban tổ chức @everyone ơi`,
                mention_everyone: false,
                mention_roles: [{ id: helpersId, name: 'Trợ giảng' }]
            })
            // Khánh is named (an account), but is not in the server: no one to tell. An id of no account is left out.
            expect(res.body.data.mention_users.map((user: { id: string }) => user.id)).toEqual([
                users.chi.id,
                users.khanh.id
            ])
            expect(await mentionRows(res.body.data.id)).toEqual([users.chi.id])
            expect(await watching()).toEqual([{ message: res.body.data, nonce: expect.any(String) }])
            const shown = (await history('dung', channelId)).body.data.items.at(-1)
            expect(shown).toMatchObject({
                mention_everyone: false,
                mention_users: res.body.data.mention_users,
                mention_roles: res.body.data.mention_roles
            })

            // A reply line names them too (D-171).
            const answer = await reply('chi', channelId, 'Mình đây', res.body.data.id)
            expect(answer.body.data.reply_to).toMatchObject({
                mention_users: res.body.data.mention_users,
                mention_roles: res.body.data.mention_roles
            })
        })

        it('lets MENTION_EVERYONE mention everyone and any role, kept on the message', async () => {
            const res = await send('an', channelId, `@everyone <@&${organisersId}>`)

            expect(res.body.data).toMatchObject({
                mention_everyone: true,
                mention_roles: [{ id: organisersId, name: 'Ban tổ chức' }]
            })
            const row = await prisma.message.findUniqueOrThrow({ where: { id: res.body.data.id } })
            expect(row).toMatchObject({ mentionEveryone: true, mentionRoleIds: [organisersId] })
        })

        it('tells the author answered and those who see the channel, never the sender, nothing from code', async () => {
            const asked = await send('chi', channelId, 'Câu 3 làm sao?')
            const answer = await reply('binh', channelId, `Mình nè <@${users.binh.id}>`, asked.body.data.id)
            expect(await mentionRows(answer.body.data.id)).toEqual([users.chi.id])

            // #ban-can-su is the owner's alone: Bình cannot see what names him there.
            const secret = await send('an', secretId, `<@${users.binh.id}>`)
            expect(await mentionRows(secret.body.data.id)).toEqual([])

            const code = await send('an', channelId, `\`<@${users.dung.id}>\` \`@everyone\``)
            expect(await mentionRows(code.body.data.id)).toEqual([])
            expect(code.body.data.mention_everyone).toBe(false)
        })

        it('writes who a message is about again when it is edited', async () => {
            const sent = await send('binh', channelId, `<@${users.chi.id}> xem giúp`)
            expect(await mentionRows(sent.body.data.id)).toEqual([users.chi.id])

            const edited = await edit('binh', sent.body.data.id, `<@${users.dung.id}> xem giúp`)
            expect(edited.body.data.mention_users).toMatchObject([{ id: users.dung.id }])
            expect(await mentionRows(sent.body.data.id)).toEqual([users.dung.id])

            await edit('binh', sent.body.data.id, 'Thôi, xong rồi')
            expect(await mentionRows(sent.body.data.id)).toEqual([])
        })
    })

    describe('editing, deleting and replying (REQ-MSG-05, SRS 1.70)', () => {
        /** A fresh channel, so these pages hold only this group's messages. */
        async function newChannel(name: string): Promise<string> {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name })
            return res.body.data.id as string
        }

        it('lets the author edit, marks it edited and tells the channel the message as it now is', async () => {
            const channelId = await newChannel('sua-tin')
            const sent = await send('binh', channelId, 'Mình vào sớm giữ chỗ')
            const watching = collect(await connectAs('an'), 'message.updated')

            const res = await edit('binh', sent.body.data.id, '  Mình vào phòng rồi nhé \n')

            expect(res.status).toBe(200)
            expect(res.body.data).toMatchObject({ id: sent.body.data.id, content: 'Mình vào phòng rồi nhé' })
            expect(Date.parse(res.body.data.edited_at as string)).toBeGreaterThan(Date.now() - 10_000)
            expect(await watching()).toEqual([{ message: res.body.data }])
            expect((await history('chi', channelId)).body.data.items[0]).toMatchObject({
                content: 'Mình vào phòng rồi nhé',
                edited_at: res.body.data.edited_at
            })
        })

        it("refuses editing someone else's message, an empty text, and a message one cannot see", async () => {
            const channelId = await newChannel('sua-tin-khac')
            const sent = await send('binh', channelId, 'Tin của Bình')
            const secret = await send('an', secretId, 'Tin bí mật')

            expect(outcome(await edit('an', sent.body.data.id, 'Sửa hộ'))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect(outcome(await edit('binh', sent.body.data.id, ' \n '))).toEqual([422, 'VALIDATION_ERROR'])
            expect(outcome(await edit('binh', secret.body.data.id, 'Sửa'))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await edit('binh', randomUUID(), 'Sửa'))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('soft-deletes in one go: the text, mentions, reactions, pin and files go, the row stays', async () => {
            const channelId = await newChannel('xoa-tin')
            const sent = await send('binh', channelId, 'Xóa tin này nhé')
            const id: string = sent.body.data.id
            await prisma.message.update({ where: { id }, data: { mentionEveryone: true, mentionRoleIds: ['r1'] } })
            await prisma.messageMention.create({ data: { messageId: id, channelId, userId: users.an.id } })
            await prisma.reaction.create({ data: { messageId: id, emoji: '👍', userId: users.chi.id } })
            await prisma.pin.create({ data: { channelId, messageId: id, pinnedById: users.an.id } })
            const file = await prisma.attachment.create({
                data: {
                    uploaderId: users.binh.id,
                    messageId: id,
                    position: 0,
                    filename: 'cau3.jpg',
                    size: 1024,
                    storageKey: `itest/${randomUUID()}.jpg`
                }
            })
            const watching = collect(await connectAs('chi'), 'message.deleted')

            const res = await remove('binh', id)

            expect(res.status).toBe(200)
            expect(await watching()).toEqual([{ id, channel_id: channelId }])
            const row = await prisma.message.findUniqueOrThrow({ where: { id } })
            expect(row).toMatchObject({
                content: '',
                mentionEveryone: false,
                mentionRoleIds: [],
                mentionHereUserIds: []
            })
            expect(row.deletedAt).toBeInstanceOf(Date)
            expect(await prisma.messageMention.count({ where: { messageId: id } })).toBe(0)
            expect(await prisma.reaction.count({ where: { messageId: id } })).toBe(0)
            expect(await prisma.pin.count({ where: { messageId: id } })).toBe(0)
            expect((await prisma.attachment.findUniqueOrThrow({ where: { id: file.id } })).messageId).toBeNull()
            expect((await history('an', channelId)).body.data.items).toEqual([])
            expect(outcome(await remove('binh', id))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await edit('binh', id, 'Sửa'))).toEqual([404, 'NOT_FOUND_ERROR'])
            await prisma.attachment.delete({ where: { id: file.id } })
        })

        it('answers not found to a retry of a message deleted meanwhile, the same nonce (REQ-MSG-10)', async () => {
            const channelId = await newChannel('gui-lai-tin-da-xoa')
            const nonce = randomUUID()
            const sent = await send('binh', channelId, 'Gửi rồi xóa', nonce)
            await remove('binh', sent.body.data.id)

            expect(outcome(await send('binh', channelId, 'Gửi rồi xóa', nonce))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('keeps a second edit or delete of a deleted message from the row itself, whoever wins the race', async () => {
            const channelId = await newChannel('xoa-dua')
            const sent = await send('binh', channelId, 'Hai người cùng xóa')
            const id: string = sent.body.data.id
            const repository = app.get<MessageRepositoryPort>(MESSAGE_REPOSITORY)

            expect(await repository.remove(id, new Date())).toBe(true)
            expect(await repository.remove(id, new Date())).toBe(false)
            expect(await repository.edit(id, 'Sửa sau khi xóa', NO_MENTIONS, new Date())).toBeNull()
        })

        it("lets MANAGE_MESSAGES delete someone else's message, no one else", async () => {
            const channelId = await newChannel('xoa-tin-khac')
            const sent = await send('chi', channelId, 'Tin của Chi')

            expect(outcome(await remove('binh', sent.body.data.id))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect((await remove('an', sent.body.data.id)).status).toBe(200)
        })

        it('refuses a timed-out author both editing and deleting, saying until when', async () => {
            const [id] = await seed('dung', generalId, 1)
            const timedOut = await as('an', api().patch(`/api/v1/servers/${serverId}/members/${users.dung.id}`)).send({
                timeout_seconds: 60
            })
            expect(timedOut.status).toBe(200)

            const edited = await edit('dung', id, 'Sửa')
            const deleted = await remove('dung', id)

            expect(outcome(edited)).toEqual([403, 'MEMBER_TIMED_OUT'])
            expect(outcome(deleted)).toEqual([403, 'MEMBER_TIMED_OUT'])
            expect(deleted.body.data.timeout_until).toBe(edited.body.data.timeout_until)
        })

        it('quotes the message a reply answers, as it is now, and says once it is deleted', async () => {
            const channelId = await newChannel('tra-loi')
            const original = await send('an', channelId, 'Ok, mình vào sớm giữ chỗ')

            const res = await reply('chi', channelId, 'Mình giữ chỗ cạnh An rồi nè', original.body.data.id)

            expect(res.status).toBe(201)
            expect(res.body.data.reply_to).toMatchObject({
                id: original.body.data.id,
                author: { id: users.an.id },
                content: 'Ok, mình vào sớm giữ chỗ',
                deleted: false
            })
            await edit('an', original.body.data.id, 'Mình vào trễ chút')
            const answer = () => history('binh', channelId).then((page) => page.body.data.items.at(-1).reply_to)
            expect(await answer()).toMatchObject({ content: 'Mình vào trễ chút', deleted: false })

            await remove('an', original.body.data.id)
            expect(await answer()).toEqual({
                id: original.body.data.id,
                author: null,
                content: '',
                deleted: true,
                mention_users: [],
                mention_roles: []
            })
            const late = await reply('binh', channelId, 'Vẫn trả lời được', original.body.data.id)
            expect(late.status).toBe(201)
            expect(late.body.data.reply_to).toMatchObject({ deleted: true })
        })

        it('refuses to answer a message of another channel, an unknown one, or a system message', async () => {
            const channelId = await newChannel('tra-loi-sai')
            const elsewhere = await send('an', generalId, 'Ở kênh chung')
            const system = await prisma.message.create({
                data: { channelId, type: 'system', systemEvent: 'member_joined', systemData: { userId: users.chi.id } },
                select: { id: true }
            })

            for (const target of [elsewhere.body.data.id as string, randomUUID(), system.id]) {
                expect(outcome(await reply('binh', channelId, 'Trả lời', target))).toEqual([422, 'VALIDATION_ERROR'])
            }
            expect(outcome(await remove('an', system.id))).toEqual([403, 'FORBIDDEN_ERROR'])
            await prisma.message.delete({ where: { id: system.id } })
        })
    })
})
