import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { NestExpressApplication } from '@nestjs/platform-express'
import { CommandBus } from '@nestjs/cqrs'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { CleanUpNotificationsCommand } from '@/modules/notifications'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

interface Item {
    id: string
    type: string
    channel_id: string
    message_id: string
    reason: string | null
    role_id: string | null
    read_at: string | null
    actor: { id: string } | null
    message: { content: string } | null
}

/**
 * The inbox through the whole app (REQ-NOTIF-01 to 03, SRS 5.1 / 5.2,
 * D-183, D-188, D-198, D-199): items written after a message is saved, by
 * name, by reply, by @everyone and @role, read in the channel or the inbox,
 * following edits and deletes, hidden with the channel, cleaned up after 90
 * days, and what each person's tabs hear.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Inbox (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-notif-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi' | 'dung'

    let app: NestExpressApplication
    let prisma: PrismaService
    let socketUrl: string
    const users = {} as Record<Who, { token: string; id: string }>
    const opened: Socket[] = []
    let serverId: string
    let chatId: string
    let secretId: string
    let leadId: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }

    /** Sends, waiting out the 5 messages in 5 seconds (REQ-MSG-10) these tests run into. */
    const send = async (who: Who, channelId: string, content: string, replyToId?: string): Promise<string> => {
        for (;;) {
            const res = await as(who, api().post(`/api/v1/channels/${channelId}/messages`))
                .set('Idempotency-Key', randomUUID())
                .send({ content, nonce: randomUUID(), ...(replyToId && { reply_to_id: replyToId }) })
            if (res.status === 429) {
                await new Promise((resolve) => setTimeout(resolve, Number(res.headers['retry-after']) * 1000))
                continue
            }
            expect(res.status).toBe(201)
            return res.body.data.id
        }
    }
    const edit = (who: Who, messageId: string, content: string) =>
        as(who, api().patch(`/api/v1/messages/${messageId}`)).send({ content })
    const ack = (who: Who, channelId: string, messageId: string) =>
        as(who, api().post(`/api/v1/channels/${channelId}/ack`)).send({ message_id: messageId })
    const inbox = async (who: Who, query = '') => {
        const res = await as(who, api().get(`/api/v1/me/notifications${query}`))
        expect(res.status).toBe(200)
        return res.body.data as { items: Item[]; unread_count: number; has_more: boolean }
    }
    const markRead = (who: Who, body: object) => as(who, api().post('/api/v1/me/notifications/read')).send(body)
    const itemOf = async (who: Who, messageId: string) =>
        (await inbox(who)).items.find((item) => item.message_id === messageId)
    const mention = (who: Who) => `<@${users[who].id}>`

    /** Items are written after the message is saved (D-183): wait for them. */
    async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
        for (let tries = 0; ; tries++) {
            const value = await read()
            if (done(value) || tries > 40) return value
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
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

    beforeAll(async () => {
        app = await bootApp()
        await app.listen(0)
        socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi', 'dung'] as Who[]) await signUp(who)

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
        // "Trưởng nhóm": mentionable, Chi holds it, and only it sees #ban-can-su.
        const role = await as('an', api().post(`/api/v1/servers/${serverId}/roles`))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Trưởng nhóm' })
        leadId = role.body.data.role_id
        await as('an', api().patch(`/api/v1/servers/${serverId}/roles/${leadId}`)).send({ mentionable: true })
        await as('an', api().put(`/api/v1/servers/${serverId}/roles/${leadId}/members`)).send({
            user_ids: [users.chi.id]
        })
        const channel = async (name: string, isPrivate: boolean) => {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name, is_private: isPrivate, view_role_ids: isPrivate ? [leadId] : [] })
            return res.body.data.id as string
        }
        chatId = await channel('hoi-dap', false)
        secretId = await channel('ban-can-su', true)
    })

    afterEach(() => {
        for (const socket of opened.splice(0)) socket.disconnect()
    })

    afterAll(async () => {
        const all = Object.values(users).map((user) => user.id)
        await prisma?.server.deleteMany({ where: { ownerId: { in: all } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    describe('items from messages (REQ-NOTIF-01, D-183)', () => {
        it('gives the person mentioned one unread item with the message as it is, and tells their tabs', async () => {
            const chi = await connectAs('chi')
            const heard = collect(chi, 'notification.created')
            const before = (await inbox('chi')).unread_count

            const messageId = await send('binh', chatId, `${mention('chi')} mai mang laptop nhé`)
            const item = await eventually(
                () => itemOf('chi', messageId),
                (found) => !!found
            )
            expect(item).toMatchObject({
                type: 'mention',
                reason: 'user',
                read_at: null,
                actor: { id: users.binh.id },
                message: { content: `${mention('chi')} mai mang laptop nhé` }
            })
            expect((await inbox('chi')).unread_count).toBe(before + 1)
            expect(await heard()).toEqual([{ notification: expect.objectContaining({ id: item!.id }) }])
            expect(await itemOf('binh', messageId)).toBeUndefined()
        })

        it('makes an answer a reply, and an answer that also mentions its author one mention', async () => {
            const asked = await send('binh', chatId, 'Ai có đề cương không?')
            const answer = await send('chi', chatId, 'Mình có nè', asked)
            const both = await send('dung', chatId, `${mention('binh')} gửi lại nhé`, asked)

            const reply = await eventually(
                () => itemOf('binh', answer),
                (found) => !!found
            )
            expect(reply).toMatchObject({ type: 'reply', reason: null })
            const mentioned = await eventually(
                () => itemOf('binh', both),
                (found) => !!found
            )
            expect(mentioned).toMatchObject({ type: 'mention', reason: 'user' })
            expect((await inbox('binh')).items.filter((item) => item.message_id === both)).toHaveLength(1)
        })

        it('gives @here an item to those online when it was sent, only them (D-166)', async () => {
            await connectAs('binh')
            const here = await send('an', chatId, '@here ai đang online vào phòng nhé')
            expect(
                await eventually(
                    () => itemOf('binh', here),
                    (found) => !!found
                )
            ).toMatchObject({ reason: 'here' })
            const rows = await prisma.notification.findMany({ where: { messageId: here } })
            // Dũng never connected; Chi's tab of the first test may still count as online (D-174).
            expect(rows.map((row) => row.userId)).toContain(users.binh.id)
            expect(rows.map((row) => row.userId)).not.toContain(users.dung.id)
        })

        it('gives @everyone one item to each viewer but the author, @role to its holders who view the channel', async () => {
            const everyone = await send('an', chatId, '@everyone 22:30 chữa đề nhé')
            const lead = await send('binh', chatId, `<@&${leadId}> duyệt giúp`)
            const secret = await send('an', secretId, '@everyone họp ban cán sự')

            for (const who of ['binh', 'chi', 'dung'] as Who[]) {
                const item = await eventually(
                    () => itemOf(who, everyone),
                    (found) => !!found
                )
                expect(item).toMatchObject({ reason: 'everyone' })
            }
            expect(await itemOf('an', everyone)).toBeUndefined()
            expect(
                await eventually(
                    () => itemOf('chi', lead),
                    (found) => !!found
                )
            ).toMatchObject({ reason: 'role', role_id: leadId })
            expect(
                await eventually(
                    () => itemOf('chi', secret),
                    (found) => !!found
                )
            ).toBeDefined()
            const rows = await prisma.notification.findMany({ where: { messageId: secret } })
            expect(rows.map((row) => row.userId)).toEqual([users.chi.id])
        })
    })

    describe('reading (REQ-NOTIF-02, D-188, D-99)', () => {
        it('reads the items of a channel up to where it is read, on every tab, and not the ones after', async () => {
            const first = await send('binh', chatId, `${mention('dung')} một`)
            const second = await send('binh', chatId, `${mention('dung')} hai`)
            await eventually(
                () => itemOf('dung', second),
                (found) => !!found
            )
            const dung = await connectAs('dung')
            const heard = collect(dung, 'notification.read')

            expect((await ack('dung', chatId, first)).status).toBe(200)
            const read = await eventually(
                () => itemOf('dung', first),
                (found) => found?.read_at !== null
            )
            expect(read!.read_at).not.toBeNull()
            expect((await itemOf('dung', second))!.read_at).toBeNull()
            // With the @everyone item before it in the channel.
            expect(await heard()).toEqual([
                {
                    ids: expect.arrayContaining([read!.id]),
                    before_id: null,
                    unread_count: (await inbox('dung')).unread_count
                }
            ])
        })

        it('reads them when one sends in the channel too (D-173)', async () => {
            const asked = await send('binh', chatId, `${mention('dung')} có đó không?`)
            await eventually(
                () => itemOf('dung', asked),
                (found) => !!found
            )
            await send('dung', chatId, 'Có')
            expect(
                (await eventually(
                    () => itemOf('dung', asked),
                    (found) => found?.read_at !== null
                ))!.read_at
            ).not.toBeNull()
        })

        it('marks read in the inbox without reading the channel, and "all" stops at the newest shown', async () => {
            await ack('chi', chatId, await send('chi', chatId, 'Mình đọc hết rồi'))
            const one = await send('binh', chatId, `${mention('chi')} một`)
            const two = await send('binh', chatId, `${mention('chi')} hai`)
            const newest = await eventually(
                () => itemOf('chi', two),
                (found) => !!found
            )
            const res = await markRead('chi', { all: true, before_id: newest!.id })
            expect(res.status).toBe(200)
            expect(res.body.data).toEqual({ unread_count: 0 })
            const later = await send('binh', chatId, `${mention('chi')} ba`)
            const after = await eventually(
                () => itemOf('chi', later),
                (found) => !!found
            )
            expect(after!.read_at).toBeNull()
            // The channel still has the two mentions unread (D-99).
            const states = await as('chi', api().get('/api/v1/me/read-states'))
            const state = (states.body.data.items as { channel_id: string; mention_count: number }[]).find(
                (candidate) => candidate.channel_id === chatId
            )
            expect(state!.mention_count).toBe(3)
            expect((await markRead('chi', { ids: [after!.id] })).body.data).toEqual({ unread_count: 0 })
            expect(one).toBeDefined()
        })

        it('turns away a request naming nothing, or more than 100 items', async () => {
            expect((await markRead('chi', {})).status).toBe(422)
            const many = Array.from({ length: 101 }, () => randomUUID())
            expect((await markRead('chi', { ids: many })).status).toBe(422)
            expect((await markRead('chi', { all: true })).status).toBe(422)
        })
    })

    describe('following the message (REQ-NOTIF-03, D-188, D-199)', () => {
        it('an edit adds and takes off items; one added for a message already read is read', async () => {
            const said = await send('an', chatId, `${mention('binh')} xem lại`)
            await eventually(
                () => itemOf('binh', said),
                (found) => !!found
            )
            await ack('dung', chatId, said)
            const binh = await connectAs('binh')
            const gone = collect(binh, 'notification.deleted')

            expect((await edit('an', said, `${mention('dung')} xem lại`)).status).toBe(200)
            const added = await eventually(
                () => itemOf('dung', said),
                (found) => !!found
            )
            expect(added!.read_at).not.toBeNull()
            expect(await itemOf('binh', said)).toBeUndefined()
            expect(await gone()).toEqual([{ ids: [expect.any(String)], unread_count: expect.any(Number) }])
        })

        it('a deleted message takes its items with it', async () => {
            const said = await send('an', chatId, `${mention('binh')} tin sẽ xóa`)
            await eventually(
                () => itemOf('binh', said),
                (found) => !!found
            )
            expect((await as('an', api().delete(`/api/v1/messages/${said}`))).status).toBe(200)
            await eventually(
                () => prisma.notification.count({ where: { messageId: said } }),
                (count) => count === 0
            )
            expect(await itemOf('binh', said)).toBeUndefined()
        })

        it('a ban that deletes the member’s recent messages takes their items with them (D-181)', async () => {
            const chi = await connectAs('chi')
            const gone = collect(chi, 'notification.deleted')
            const said = await send('dung', chatId, `${mention('chi')} tin trước khi bị cấm`)
            await eventually(
                () => itemOf('chi', said),
                (found) => !!found
            )
            const banned = await as('an', api().put(`/api/v1/servers/${serverId}/bans/${users.dung.id}`)).send({
                delete_message_days: 1
            })
            expect(banned.status).toBe(200)
            await eventually(
                () => prisma.notification.count({ where: { messageId: said } }),
                (count) => count === 0
            )
            expect(await itemOf('chi', said)).toBeUndefined()
            expect(await gone()).toContainEqual({ ids: [expect.any(String)], unread_count: expect.any(Number) })
        })

        it('hides the items of a channel one no longer views, and shows them again when one does', async () => {
            const said = await send('an', secretId, `${mention('chi')} họp ban cán sự`)
            await eventually(
                () => itemOf('chi', said),
                (found) => !!found
            )
            const before = await inbox('chi')
            const secretUnread = before.items.filter((item) => item.channel_id === secretId && !item.read_at).length
            await as('an', api().delete(`/api/v1/servers/${serverId}/members/${users.chi.id}/roles/${leadId}`))
            const hidden = await eventually(
                () => inbox('chi'),
                (list) => !list.items.some((item) => item.message_id === said)
            )
            expect(hidden.unread_count).toBe(before.unread_count - secretUnread)

            await as('an', api().put(`/api/v1/servers/${serverId}/roles/${leadId}/members`)).send({
                user_ids: [users.chi.id]
            })
            const back = await eventually(
                () => itemOf('chi', said),
                (found) => !!found
            )
            expect(back!.read_at).toBeNull()
        })
    })

    describe('the inbox itself', () => {
        it('pages newest first', async () => {
            const page = await inbox('binh', '?limit=2')
            expect(page.items).toHaveLength(2)
            expect(page.has_more).toBe(true)
            const next = await inbox('binh', `?limit=2&before=${page.items[1]!.id}`)
            expect(next.items[0]!.id < page.items[1]!.id).toBe(true)
        })

        it('cleans up the items older than 90 days, read or not (REQ-NOTIF-03)', async () => {
            const said = await send('an', chatId, 'Tin cũ')
            const old = await prisma.notification.create({
                data: {
                    userId: users.binh.id,
                    type: 'mention',
                    serverId,
                    channelId: chatId,
                    messageId: said,
                    actorId: users.an.id,
                    createdAt: new Date(Date.now() - 91 * 86_400_000)
                }
            })
            await app.get(CommandBus).execute(new CleanUpNotificationsCommand(new Date()))
            expect(await prisma.notification.findUnique({ where: { id: old.id } })).toBeNull()
        })
    })
})
