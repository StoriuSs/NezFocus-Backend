import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { Permission } from '@/modules/permissions'
import { MAX_PINS, MAX_REACTION_EMOJI } from '@/modules/messaging/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Reactions and pins through the whole app (REQ-MSG-05, REQ-MSG-07,
 * REQ-MSG-08, SRS 1.71): who may react and pin, the limits of 20 emoji and
 * 50 pins held under concurrent requests, the system message a pin posts,
 * what history and the pins panel read, and the events the channel hears.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Reactions and pins (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-react-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi' | 'dung'

    let app: NestExpressApplication
    let prisma: PrismaService
    let socketUrl: string
    const users = {} as Record<Who, { token: string; id: string }>
    const opened: Socket[] = []
    let serverId: string
    let generalId: string
    let otherId: string
    let secretId: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]

    /** A message of `who`, straight into the database: these tests send more than the limits of sending allow. */
    const send = async (who: Who, channelId: string, content: string): Promise<string> => {
        const row = await prisma.message.create({
            data: { channelId, authorId: users[who].id, content, nonce: randomUUID() },
            select: { id: true }
        })
        return row.id
    }
    const reactionUrl = (messageId: string, emoji: string) =>
        `/api/v1/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
    const react = (who: Who, messageId: string, emoji: string) => as(who, api().put(reactionUrl(messageId, emoji)))
    const unreact = (who: Who, messageId: string, emoji: string) => as(who, api().delete(reactionUrl(messageId, emoji)))
    const reactors = (who: Who, messageId: string, emoji: string) => as(who, api().get(reactionUrl(messageId, emoji)))
    const pin = (who: Who, channelId: string, messageId: string) =>
        as(who, api().put(`/api/v1/channels/${channelId}/pins/${messageId}`))
    const unpin = (who: Who, channelId: string, messageId: string) =>
        as(who, api().delete(`/api/v1/channels/${channelId}/pins/${messageId}`))
    const pins = (who: Who, channelId: string) => as(who, api().get(`/api/v1/channels/${channelId}/pins`))
    const history = (who: Who, channelId: string) => as(who, api().get(`/api/v1/channels/${channelId}/messages`))
    const remove = (who: Who, messageId: string) => as(who, api().delete(`/api/v1/messages/${messageId}`))

    /** One message of the history as `who` reads it. */
    const read = async (who: Who, channelId: string, messageId: string) => {
        const res = await history(who, channelId)
        return (res.body.data.items as { id: string }[]).find((item) => item.id === messageId) as
            | Record<string, unknown>
            | undefined
    }

    /**
     * A delete of the message begun and not yet committed, done as the
     * repository's `remove` does it (the row emptied, its reactions and pin
     * dropped); `during` runs while it holds the row.
     */
    async function whileDeleting(messageId: string, during: () => Promise<void>) {
        await prisma.$transaction(
            async (tx) => {
                await tx.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), content: '' } })
                await tx.reaction.deleteMany({ where: { messageId } })
                await tx.pin.deleteMany({ where: { messageId } })
                await during()
            },
            { timeout: 10_000 }
        )
    }

    /** Starts the request now and says whether it has answered yet. */
    function started(req: request.Test) {
        let answered = false
        const response = req.then((res) => {
            answered = true
            return res
        })
        return { response, answered: () => answered }
    }

    const aMoment = () => new Promise((resolve) => setTimeout(resolve, 500))

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

    /** `count` messages of An straight into the database. */
    async function seed(channelId: string, count: number): Promise<string[]> {
        const ids: string[] = []
        for (let i = 0; i < count; i++) {
            const row = await prisma.message.create({
                data: { channelId, authorId: users.an.id, content: `Tin ${i + 1}`, nonce: randomUUID() },
                select: { id: true }
            })
            ids.push(row.id)
        }
        return ids
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
        const make = async (name: string, isPrivate = false) => {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name, is_private: isPrivate, view_role_ids: [] })
            return res.body.data.id as string
        }
        otherId = await make('tai-lieu')
        secretId = await make('ban-can-su', true)
        const channels = await prisma.channel.findMany({
            where: { serverId },
            select: { id: true, name: true, type: true }
        })
        generalId = channels.find((channel) => channel.type === 'text' && ![otherId, secretId].includes(channel.id))!.id
    })

    afterEach(() => {
        for (const socket of opened.splice(0)) socket.disconnect()
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.message.deleteMany({ where: { authorId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    describe('reactions (REQ-MSG-05)', () => {
        it('adds an emoji once, as each reader sees it, tells the channel once, and takes it off', async () => {
            const messageId = await send('an', generalId, 'Đề cương ôn tập giữa kỳ')
            const chi = await connectAs('chi')
            const added = collect(chi, 'reaction.added')
            const removed = collect(chi, 'reaction.removed')

            expect((await react('binh', messageId, '👍')).status).toBe(200)
            expect((await react('binh', messageId, '👍')).status).toBe(200)
            expect((await react('chi', messageId, '👍')).status).toBe(200)
            expect((await react('chi', messageId, '🎉')).status).toBe(200)

            expect((await read('binh', generalId, messageId))?.reactions).toEqual([
                { emoji: '👍', count: 2, me: true },
                { emoji: '🎉', count: 1, me: false }
            ])
            expect((await read('an', generalId, messageId))?.reactions).toEqual([
                { emoji: '👍', count: 2, me: false },
                { emoji: '🎉', count: 1, me: false }
            ])
            expect(await added()).toEqual([
                { channel_id: generalId, message_id: messageId, emoji: '👍', user_id: users.binh.id },
                { channel_id: generalId, message_id: messageId, emoji: '👍', user_id: users.chi.id },
                { channel_id: generalId, message_id: messageId, emoji: '🎉', user_id: users.chi.id }
            ])

            expect((await unreact('binh', messageId, '👍')).status).toBe(200)
            expect((await unreact('binh', messageId, '👍')).status).toBe(200)
            expect(await removed()).toEqual([
                { channel_id: generalId, message_id: messageId, emoji: '👍', user_id: users.binh.id }
            ])
            expect((await read('binh', generalId, messageId))?.reactions).toEqual([
                { emoji: '👍', count: 1, me: false },
                { emoji: '🎉', count: 1, me: false }
            ])
        })

        it('names the first three people to give an emoji, in order, and counts them all', async () => {
            const messageId = await send('an', generalId, 'Ai làm xong câu 3 chưa?')
            for (const who of ['chi', 'an', 'binh', 'dung'] as Who[]) await react(who, messageId, '🔥')

            const res = await reactors('binh', messageId, '🔥')

            expect(res.status).toBe(200)
            expect(res.body.data.count).toBe(4)
            expect((res.body.data.users as { id: string }[]).map((user) => user.id)).toEqual([
                users.chi.id,
                users.an.id,
                users.binh.id
            ])
        })

        it('refuses what is not one standard emoji, and a system message', async () => {
            const messageId = await send('an', generalId, 'Xin chào')
            expect(outcome(await react('binh', messageId, ':+1:'))).toEqual([422, 'VALIDATION_ERROR'])
            expect(outcome(await react('binh', messageId, '👍👍'))).toEqual([422, 'VALIDATION_ERROR'])

            const system = await prisma.message.create({
                data: {
                    channelId: generalId,
                    type: 'system',
                    systemEvent: 'member_joined',
                    systemData: { userId: users.dung.id },
                    content: ''
                },
                select: { id: true }
            })
            expect(outcome(await react('binh', system.id, '👍'))).toEqual([422, 'VALIDATION_ERROR'])
            expect(outcome(await pin('an', generalId, system.id))).toEqual([422, 'VALIDATION_ERROR'])
        })

        it('answers not found for a message in a channel one may not view, or a deleted one', async () => {
            const messageId = await send('an', secretId, 'Họp cán sự')
            expect(outcome(await react('binh', messageId, '👍'))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await reactors('binh', messageId, '👍'))).toEqual([404, 'NOT_FOUND_ERROR'])

            const deleted = await send('an', generalId, 'Tin đã xóa')
            expect((await remove('an', deleted)).status).toBe(200)
            expect(outcome(await react('binh', deleted, '👍'))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('holds 20 different emoji when two new ones come at once', async () => {
            const messageId = await send('an', generalId, 'Bình chọn giờ học nhóm')
            const nineteen = ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊']
            const more = ['👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '🎉', '✅']
            await prisma.reaction.createMany({
                data: [...nineteen, ...more].map((emoji) => ({ messageId, emoji, userId: users.an.id }))
            })

            const results = await Promise.all([react('binh', messageId, '🤔'), react('chi', messageId, '🤯')])

            expect(results.map((res) => res.status).sort()).toEqual([200, 409])
            expect(results.find((res) => res.status === 409)?.body.meta.type).toBe('MAX_REACTIONS_REACHED')
            const emojis = await prisma.reaction.groupBy({ by: ['emoji'], where: { messageId } })
            expect(emojis).toHaveLength(MAX_REACTION_EMOJI)
            // One more person on an emoji already there still fits.
            expect((await react('dung', messageId, '👍')).status).toBe(200)
        })

        it('waits for a delete of the message under way, then finds it gone: no reaction left on it', async () => {
            const messageId = await send('an', generalId, 'Tin sắp xóa')
            let request!: ReturnType<typeof started>

            await whileDeleting(messageId, async () => {
                request = started(react('binh', messageId, '👍'))
                await aMoment()
                expect(request.answered()).toBe(false)
            })

            expect(outcome(await request.response)).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(await prisma.reaction.count({ where: { messageId } })).toBe(0)
        })

        it('keeps one emoji one reaction, sent with a variation selector it does not need', async () => {
            const messageId = await send('an', generalId, 'Ai đi học nhóm tối nay?')

            expect((await react('binh', messageId, '👍\u{FE0F}')).status).toBe(200)
            expect((await react('chi', messageId, '👍')).status).toBe(200)

            expect((await read('binh', generalId, messageId))?.reactions).toEqual([{ emoji: '👍', count: 2, me: true }])
            expect((await unreact('binh', messageId, '👍\u{FE0F}')).status).toBe(200)
            expect((await reactors('an', messageId, '👍\u{FE0F}')).body.data.count).toBe(1)
        })

        it('without ADD_REACTIONS, lets one click an emoji already there, not add a new one', async () => {
            const everyone = await prisma.role.findFirstOrThrow({ where: { serverId, isEveryone: true } })
            const without = (everyone.permissions & ~Permission.ADD_REACTIONS).toString()
            const changed = await as('an', api().patch(`/api/v1/servers/${serverId}/roles/${everyone.id}`)).send({
                permissions: without
            })
            expect(changed.status).toBe(200)
            try {
                const messageId = await send('an', generalId, 'Chốt lịch thứ 7')
                await react('an', messageId, '👍')

                expect((await react('binh', messageId, '👍')).status).toBe(200)
                expect(outcome(await react('binh', messageId, '🎉'))).toEqual([403, 'FORBIDDEN_ERROR'])
            } finally {
                await as('an', api().patch(`/api/v1/servers/${serverId}/roles/${everyone.id}`)).send({
                    permissions: everyone.permissions.toString()
                })
            }
        })
    })

    describe('pins (REQ-MSG-07, REQ-MSG-08)', () => {
        it('pins once with a system message the channel hears, reads them latest first, and unpins quietly', async () => {
            const first = await send('chi', generalId, 'Tổng hợp công thức chương 3')
            const second = await send('chi', generalId, 'Đề cương ôn tập giữa kỳ')
            const binh = await connectAs('binh')
            const updates = collect(binh, 'pins.updated')
            const created = collect(binh, 'message.created')

            expect((await pin('an', generalId, first)).status).toBe(200)
            expect((await pin('an', generalId, second)).status).toBe(200)
            expect((await pin('an', generalId, second)).status).toBe(200)

            expect(await updates()).toEqual([
                { channel_id: generalId, message_id: first, pinned: true },
                { channel_id: generalId, message_id: second, pinned: true }
            ])
            const notices = (await created()) as { message: Record<string, unknown>; nonce: string | null }[]
            expect(notices).toHaveLength(2)
            expect(notices[1]).toMatchObject({
                nonce: null,
                message: {
                    type: 'system',
                    author: null,
                    system_event: 'message_pinned',
                    system_data: { user_id: users.an.id, message_id: second },
                    system_user: { id: users.an.id }
                }
            })

            const listed = await pins('binh', generalId)
            expect(listed.status).toBe(200)
            expect((listed.body.data.items as { id: string }[]).map((item) => item.id)).toEqual([second, first])
            expect(listed.body.data.items[0]).toMatchObject({ pinned: true, reactions: [] })
            expect((await read('binh', generalId, first))?.pinned).toBe(true)
            const notice = (await read('binh', generalId, notices[0]!.message.id as string)) as {
                system_user: { id: string; display_name: string | null } | null
            }
            expect(notice.system_user?.id).toBe(users.an.id)

            const unpinUpdates = collect(binh, 'pins.updated')
            const unpinCreated = collect(binh, 'message.created')
            expect((await unpin('an', generalId, first)).status).toBe(200)
            expect(await unpinUpdates()).toEqual([{ channel_id: generalId, message_id: first, pinned: false }])
            expect(await unpinCreated()).toEqual([])
            expect((await read('binh', generalId, first))?.pinned).toBe(false)
        })

        it('refuses pinning and unpinning without MANAGE_MESSAGES, and a message of another channel than the route', async () => {
            const messageId = await send('chi', generalId, 'Tài liệu tham khảo')
            expect(outcome(await pin('binh', generalId, messageId))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect((await pin('an', generalId, messageId)).status).toBe(200)
            expect(outcome(await unpin('binh', generalId, messageId))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect(outcome(await pin('an', otherId, messageId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await pins('binh', secretId))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('holds 50 pins in a channel when two pins come at once', async () => {
            const [a, b, ...earlier] = await seed(otherId, MAX_PINS + 1)
            await prisma.pin.createMany({ data: earlier.map((messageId) => ({ channelId: otherId, messageId })) })

            const results = await Promise.all([pin('an', otherId, a!), pin('an', otherId, b!)])

            expect(results.map((res) => res.status).sort()).toEqual([200, 409])
            expect(results.find((res) => res.status === 409)?.body.meta.type).toBe('MAX_PINS_REACHED')
            expect(await prisma.pin.count({ where: { channelId: otherId } })).toBe(MAX_PINS)
        })

        it('waits for a delete of the message under way, then finds it gone: no pin, no system message', async () => {
            const messageId = await send('chi', generalId, 'Tin sắp xóa')
            let request!: ReturnType<typeof started>

            await whileDeleting(messageId, async () => {
                request = started(pin('an', generalId, messageId))
                await aMoment()
                expect(request.answered()).toBe(false)
            })

            expect(outcome(await request.response)).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(await prisma.pin.count({ where: { messageId } })).toBe(0)
            const notices = await prisma.message.count({
                where: { channelId: generalId, systemData: { path: ['messageId'], equals: messageId } }
            })
            expect(notices).toBe(0)
        })
    })

    describe('timed out (SRS 1.71)', () => {
        it('refuses reacting and taking one off, with until when; reading the tooltip still works', async () => {
            const messageId = await send('an', generalId, 'Nhắc lịch thi')
            await react('dung', messageId, '👍')
            const timedOut = await as('an', api().patch(`/api/v1/servers/${serverId}/members/${users.dung.id}`)).send({
                timeout_seconds: 60
            })
            expect(timedOut.status).toBe(200)

            expect(outcome(await react('dung', messageId, '🎉'))).toEqual([403, 'MEMBER_TIMED_OUT'])
            expect(outcome(await unreact('dung', messageId, '👍'))).toEqual([403, 'MEMBER_TIMED_OUT'])
            expect((await reactors('dung', messageId, '👍')).body.data.count).toBe(1)
        })
    })
})
