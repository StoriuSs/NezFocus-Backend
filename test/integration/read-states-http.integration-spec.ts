import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

interface ReadState {
    server_id: string
    channel_id: string
    last_read_id: string
    unread_count: number
    mention_count: number
}

/**
 * Unread and read through the whole app (REQ-MSG-09, D-164, D-170, D-172,
 * D-173, SRS 5.1): where each reader stands when the app opens, what counts
 * as unread and as about them, marking a channel read, and sending as
 * reading.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Read states (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-read-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi' | 'khanh'

    let app: NestExpressApplication
    let prisma: PrismaService
    let socketUrl: string
    const users = {} as Record<Who, { token: string; id: string }>
    const opened: Socket[] = []
    let serverId: string
    let generalId: string
    let secretId: string
    /** Messages An wrote in #general before Bình joined, and one after. */
    let beforeJoin: string[]
    let afterJoin: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }

    const send = (who: Who, channelId: string, content: string, replyToId?: string) =>
        as(who, api().post(`/api/v1/channels/${channelId}/messages`))
            .set('Idempotency-Key', randomUUID())
            .send({ content, nonce: randomUUID(), ...(replyToId && { reply_to_id: replyToId }) })
    const ack = (who: Who, channelId: string, messageId?: string) =>
        as(who, api().post(`/api/v1/channels/${channelId}/ack`)).send(messageId ? { message_id: messageId } : {})
    const readStates = async (who: Who): Promise<ReadState[]> => {
        const res = await as(who, api().get('/api/v1/me/read-states'))
        expect(res.status).toBe(200)
        return res.body.data.items
    }
    const stateOf = async (who: Who, channelId: string) =>
        (await readStates(who)).find((state) => state.channel_id === channelId)
    const newChannel = async (name: string) => {
        const made = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
            .set('Idempotency-Key', randomUUID())
            .send({ type: 'text', name })
        return made.body.data.id as string
    }

    async function signUp(who: Who) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, PASSWORD)
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id }
    }

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

    function collect(socket: Socket, event: string): () => Promise<unknown[]> {
        const heard: unknown[] = []
        socket.on(event, (data: unknown) => heard.push(data))
        return () => new Promise((resolve) => setTimeout(() => resolve(heard), 400))
    }

    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    /** A message straight into the database, a few milliseconds after the last so the ids keep that order. */
    async function seed(
        who: Who | null,
        channelId: string,
        extra: { mentionEveryone?: boolean; mentionRoleIds?: string[]; content?: string; about?: Who } = {}
    ): Promise<string> {
        await pause(3)
        const row = await prisma.message.create({
            data: who
                ? {
                      channelId,
                      authorId: users[who].id,
                      content: extra.content ?? 'Đề cương ôn tập',
                      nonce: randomUUID(),
                      mentionEveryone: extra.mentionEveryone ?? false,
                      mentionRoleIds: extra.mentionRoleIds ?? []
                  }
                : {
                      channelId,
                      type: 'system',
                      systemEvent: 'member_joined',
                      systemData: { userId: users[extra.about ?? 'chi'].id }
                  },
            select: { id: true }
        })
        await pause(3)
        return row.id
    }

    beforeAll(async () => {
        app = await bootApp()
        await app.listen(0)
        socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi', 'khanh'] as Who[]) await signUp(who)

        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'standard' })
        serverId = created.body.data.id
        const channels = await prisma.channel.findMany({ where: { serverId }, select: { id: true, type: true } })
        generalId = channels.find((channel) => channel.type === 'text')!.id
        const secret = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
            .set('Idempotency-Key', randomUUID())
            .send({ type: 'text', name: 'ban-can-su', is_private: true, view_role_ids: [] })
        secretId = secret.body.data.id

        // No welcome message (D-83): these count only An's messages around the join.
        await prisma.server.update({ where: { id: serverId }, data: { welcomeChannelId: null } })
        beforeJoin = [await seed('an', generalId), await seed('an', generalId)]
        const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        for (const who of ['binh', 'chi'] as Who[]) {
            await as(who, api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
        }
        afterJoin = await seed('an', generalId)
        // When they joined, by the app's clock that made the ids: the database's
        // clock (Member.joinedAt) may drift from it by more than the few
        // milliseconds between these messages.
        const timeOf = (id: string) => parseInt(id.replace(/-/g, '').slice(0, 12), 16)
        const joinedAt = new Date((timeOf(beforeJoin[1]) + timeOf(afterJoin)) / 2)
        await prisma.member.updateMany({
            where: { serverId, userId: { in: [users.binh.id, users.chi.id] } },
            data: { joinedAt }
        })
    })

    afterEach(() => {
        for (const socket of opened.splice(0)) socket.disconnect()
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.message.deleteMany({ where: { channel: { serverId } } }).catch(() => undefined)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    describe('when the app opens (GET /me/read-states)', () => {
        it('counts only what was sent after the reader joined the server (D-170)', async () => {
            const state = await stateOf('binh', generalId)

            expect(state).toMatchObject({ server_id: serverId, unread_count: 1, mention_count: 0 })
            expect(state!.last_read_id > beforeJoin[1]).toBe(true)
            expect(state!.last_read_id < afterJoin).toBe(true)
        })

        it('counts from when the reader joined even over an older mark of theirs (left and came back, D-170)', async () => {
            expect((await ack('chi', generalId, beforeJoin[0])).status).toBe(200)

            const state = await stateOf('chi', generalId)

            expect(state).toMatchObject({ unread_count: 1 })
            expect(state!.last_read_id > beforeJoin[1]).toBe(true)
        })

        it('lists only the text channels the reader may view', async () => {
            const mine = (await readStates('binh')).map((state) => state.channel_id)
            expect(mine).toContain(generalId)
            expect(mine).not.toContain(secretId)
            expect(await stateOf('an', secretId)).toBeDefined()
            expect((await readStates('khanh')).filter((state) => state.server_id === serverId)).toEqual([])
        })

        it('does not count the reader’s own messages nor deleted ones, and counts system messages as unread, never as about them (D-173)', async () => {
            const channelId = await newChannel('chua-doc')
            await seed('binh', channelId, { mentionEveryone: true })
            const gone = await seed('an', channelId)
            expect((await as('an', api().delete(`/api/v1/messages/${gone}`))).status).toBe(200)
            await seed(null, channelId)

            expect(await stateOf('binh', channelId)).toMatchObject({ unread_count: 1, mention_count: 0 })
        })

        it('does not count a system message about the reader: it is as their own (D-173)', async () => {
            const channelId = await newChannel('ghim-tin')
            await seed(null, channelId, { about: 'binh' })

            expect(await stateOf('binh', channelId)).toMatchObject({ unread_count: 0 })
            expect(await stateOf('chi', channelId)).toMatchObject({ unread_count: 1 })
        })

        it('counts a message about the reader in two ways once, and a deleted one not at all', async () => {
            const channelId = await newChannel('mot-lan')
            expect((await send('an', channelId, `@everyone <@${users.binh.id}> họp lúc 8 giờ`)).status).toBe(201)
            const gone = await send('an', channelId, `<@${users.binh.id}> nhầm kênh`)
            expect((await as('an', api().delete(`/api/v1/messages/${gone.body.data.id}`))).status).toBe(200)

            expect(await stateOf('binh', channelId)).toMatchObject({ unread_count: 1, mention_count: 1 })
        })

        it('counts what is about the reader: a mention, an answer, @everyone, a role they hold; not their own (D-39, D-164, D-172)', async () => {
            const channelId = await newChannel('nhac-toi')
            const role = await as('an', api().post(`/api/v1/servers/${serverId}/roles`))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Nhóm 3' })
            const groupId: string = role.body.data.role_id
            await as('an', api().put(`/api/v1/servers/${serverId}/roles/${groupId}/members`)).send({
                user_ids: [users.binh.id]
            })
            const other = await as('an', api().post(`/api/v1/servers/${serverId}/roles`))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Nhóm 4' })
            const question = await seed('binh', channelId, { content: 'Câu 3 làm sao?' })

            expect((await send('an', channelId, `<@${users.binh.id}> xem lại đề nhé`)).status).toBe(201)
            expect((await send('an', channelId, 'Dùng tích phân từng phần', question)).status).toBe(201)
            await seed('an', channelId, { mentionEveryone: true })
            await seed('an', channelId, { mentionRoleIds: [groupId] })
            await seed('an', channelId, { mentionRoleIds: [other.body.data.role_id] })
            await seed('binh', channelId, { mentionRoleIds: [groupId] })

            expect(await stateOf('binh', channelId)).toMatchObject({ unread_count: 5, mention_count: 4 })
            // Chi: every message is someone else's; only @everyone is about Chi.
            expect(await stateOf('chi', channelId)).toMatchObject({ unread_count: 7, mention_count: 1 })
        })

        it('counts unread messages and mentions up to 100 (D-173)', async () => {
            const channelId = await newChannel('nhieu-tin')
            await prisma.message.createMany({
                data: Array.from({ length: 105 }, (_, i) => ({
                    channelId,
                    authorId: users.an.id,
                    content: `@everyone Tin ${i + 1}`,
                    nonce: randomUUID(),
                    mentionEveryone: true
                }))
            })

            expect(await stateOf('binh', channelId)).toMatchObject({ unread_count: 100, mention_count: 100 })
        })

        it('does not count what someone the reader blocked writes, nor its mentions; marking read answers the same (D-250)', async () => {
            const channelId = await newChannel('da-chan')
            expect((await as('chi', api().put(`/api/v1/me/blocks/${users.an.id}`))).status).toBe(200)
            try {
                const first = await send('an', channelId, `<@${users.chi.id}> <@${users.binh.id}> mai họp nhé`)
                await send('an', channelId, '@everyone nhắc lại')

                expect(await stateOf('chi', channelId)).toMatchObject({ unread_count: 0, mention_count: 0 })
                expect(await stateOf('binh', channelId)).toMatchObject({ unread_count: 2, mention_count: 2 })
                const marked = await ack('chi', channelId, first.body.data.id)
                expect(marked.body.data).toMatchObject({ unread_count: 0, mention_count: 0 })
            } finally {
                await as('chi', api().delete(`/api/v1/me/blocks/${users.an.id}`))
            }
            // Unblocked: their messages count again.
            expect(await stateOf('chi', channelId)).toMatchObject({ unread_count: 1, mention_count: 1 })
        })
    })

    describe('marking read (POST /channels/{id}/ack)', () => {
        it('marks up to the message, tells the reader’s sockets only, and answers where they stand', async () => {
            const channelId = await newChannel('danh-dau')
            const [first, second, third] = [
                await seed('an', channelId),
                await seed('an', channelId),
                await seed('an', channelId)
            ]
            const binhHears = collect(await connectAs('binh'), 'read_state.updated')
            const chiHears = collect(await connectAs('chi'), 'read_state.updated')

            const res = await ack('binh', channelId, second)

            expect(res.status).toBe(200)
            const expected = {
                server_id: serverId,
                channel_id: channelId,
                last_read_id: second,
                unread_count: 1,
                mention_count: 0
            }
            expect(res.body.data).toEqual(expected)
            expect(await binhHears()).toEqual([expected])
            expect(await chiHears()).toEqual([])
            expect(first < second && second < third).toBe(true)
        })

        it('never moves back: a tab marking an older message leaves the later mark', async () => {
            const channelId = await newChannel('khong-lui')
            const older = await seed('an', channelId)
            const newer = await seed('an', channelId)
            await ack('binh', channelId, newer)

            const res = await ack('binh', channelId, older)

            expect(res.body.data).toMatchObject({ last_read_id: newer, unread_count: 0 })
        })

        it('keeps the newest of many marks sent at once', async () => {
            const channelId = await newChannel('cung-luc')
            const ids: string[] = []
            for (let i = 0; i < 8; i++) ids.push(await seed('an', channelId))

            await Promise.all([...ids].reverse().map((id) => ack('binh', channelId, id)))

            expect(await stateOf('binh', channelId)).toMatchObject({ last_read_id: ids[7], unread_count: 0 })
        })

        it('with no message named, marks the newest ("Mark as read")', async () => {
            const channelId = await newChannel('doc-het')
            await seed('an', channelId, { mentionEveryone: true })
            const newest = await seed('an', channelId)

            const res = await ack('binh', channelId)

            expect(res.body.data).toMatchObject({ last_read_id: newest, unread_count: 0, mention_count: 0 })
            expect(await stateOf('binh', channelId)).toMatchObject({ unread_count: 0, mention_count: 0 })
        })

        it('is NOT_FOUND for a message of another channel, a channel one may not view, or a server one is not in', async () => {
            const res = await ack('binh', generalId, afterJoin)
            expect(res.status).toBe(200)

            expect((await ack('binh', secretId)).status).toBe(404)
            expect((await ack('an', secretId, afterJoin)).status).toBe(404)
            expect((await ack('khanh', generalId, afterJoin)).status).toBe(404)
            expect((await ack('binh', generalId, randomUUID())).status).toBe(404)
        })
    })

    describe('sending marks read (D-173)', () => {
        it('moves the sender’s mark to the message they sent and tells their other tabs', async () => {
            const channelId = await newChannel('gui-la-doc')
            await seed('an', channelId, { mentionEveryone: true })
            const hears = collect(await connectAs('binh'), 'read_state.updated')

            const sent = await send('binh', channelId, 'Mình đọc rồi nè')

            expect(sent.status).toBe(201)
            const heard = (await hears()) as ReadState[]
            expect(heard).toEqual([expect.objectContaining({ channel_id: channelId, last_read_id: sent.body.data.id })])
            expect(await stateOf('binh', channelId)).toMatchObject({
                last_read_id: sent.body.data.id,
                unread_count: 0,
                mention_count: 0
            })
        })
    })
})
