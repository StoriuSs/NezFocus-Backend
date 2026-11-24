import { createHash, randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { CommandBus } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort, SweepPresenceCommand } from '@/modules/realtime'
import { bootApp, closeApp, completeAccount, cookieOf, FRONTEND, pair, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * The socket through the whole app (SRS 5.2, ARCHITECTURE 3.1, D-13, D-163):
 * a ticket bought with the access token opens one connection, once; the
 * connection is put in the rooms of its user, its servers and every text
 * channel it may view, and nothing else; a session that ends is told so and
 * cut off. Presence and typing travel the same way (REQ-AUTH-07, MSG-06).
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Realtime connection (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-rt-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'

    let app: NestExpressApplication
    let prisma: PrismaService
    let publisher: EventPublisherPort
    let socketUrl: string
    const users: Record<string, { token: string; id: string }> = {}
    const opened: Socket[] = []

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: string, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }

    async function signUp(who: string) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, PASSWORD)
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id }
    }

    /** One more session of `who`, signed in with the password: its access token and its refresh cookie. */
    async function newSession(who: string) {
        const login = await post('auth/login', { email: `${PREFIX}-${who}@example.test`, password: PASSWORD })
        expect(login.status).toBe(200)
        return { token: login.body.data.access_token as string, cookie: pair(cookieOf(login, 'refresh_token')) }
    }

    const ticketWith = async (token: string) => {
        const res = await anyone(api().post('/api/v1/realtime/ticket')).set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(201)
        return res.body.data.ticket as string
    }

    const signOut = (cookie: string) => post('auth/logout').set('Cookie', cookie)

    const ticketFor = (who: string) => ticketWith(users[who].token)

    /** Opens a socket with a ticket; resolves with it and its `ready`, or rejects with the refusal. */
    function connect(ticket: string): Promise<{ socket: Socket; ready: Record<string, unknown> }> {
        const socket = io(socketUrl, {
            auth: { ticket },
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
            extraHeaders: { Origin: FRONTEND }
        })
        opened.push(socket)
        return new Promise((resolve, reject) => {
            socket.once('ready', (ready: Record<string, unknown>) => resolve({ socket, ready }))
            socket.once('connect_error', (error: Error & { data?: { type?: string } }) =>
                reject(Object.assign(new Error(error.message), { type: error.data?.type }))
            )
        })
    }

    const connectAs = async (who: string) => (await connect(await ticketFor(who))).socket

    /** Whether `socket` hears `event` within a short wait. */
    function hears(socket: Socket, event: string, within = 500): Promise<unknown> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(undefined), within)
            socket.once(event, (data: unknown) => {
                clearTimeout(timer)
                resolve(data ?? null)
            })
        })
    }

    /** Which of several `hears` heard their event. */
    const heard = async (listening: Promise<unknown>[]) =>
        (await Promise.all(listening)).map((data) => data !== undefined)

    /** A server of `owner` with `others` in it, a private text channel only the owner sees, and its public #general. */
    async function serverWith(owner: string, others: string[]) {
        const created = await as(owner, api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'standard' })
        expect(created.status).toBe(201)
        const serverId: string = created.body.data.id
        const invite = await as(owner, api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        for (const who of others) {
            expect((await as(who, api().post(`/api/v1/invites/${invite.body.data.code}/accept`))).status).toBe(200)
        }
        const secret = await as(owner, api().post(`/api/v1/servers/${serverId}/channels`))
            .set('Idempotency-Key', randomUUID())
            .send({ type: 'text', name: 'ban-can-su', is_private: true, view_role_ids: [] })
        expect(secret.status).toBe(201)
        const channels = await prisma.channel.findMany({
            where: { serverId },
            select: { id: true, name: true, type: true }
        })
        const general = channels.find((channel) => channel.type === 'text' && channel.name !== 'ban-can-su')!
        const voice = channels.find((channel) => channel.type === 'voice')
        return { serverId, generalId: general.id, secretId: secret.body.data.id as string, voiceId: voice?.id }
    }

    beforeAll(async () => {
        app = await bootApp()
        await app.listen(0)
        socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
        prisma = app.get(PrismaService)
        publisher = app.get(EVENT_PUBLISHER)
        for (const who of ['an', 'binh']) await signUp(who)
    })

    afterEach(() => {
        for (const socket of opened.splice(0)) socket.disconnect()
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    describe('the ticket (D-13)', () => {
        it('needs a signed-in request', async () => {
            const res = await anyone(api().post('/api/v1/realtime/ticket'))
            expect([res.status, res.body.meta?.type]).toEqual([401, 'AUTH_TOKEN_MISSING'])
        })

        it('opens one connection, which hears ready with the server time', async () => {
            const before = Date.now()
            const { ready } = await connect(await ticketFor('an'))
            const serverTime = Date.parse(ready.server_time as string)
            expect(serverTime).toBeGreaterThanOrEqual(before - 1000)
            expect(serverTime).toBeLessThanOrEqual(Date.now() + 1000)
        })

        it('is kept in Redis for 30 seconds, under its hash only', async () => {
            const ticket = await ticketFor('an')
            const redis = app.get<RedisClientType>(REDIS_CLIENT)
            const key = `realtime:ticket:${createHash('sha256').update(ticket).digest('hex')}`

            const ttl = await redis.ttl(key)

            expect(ttl).toBeGreaterThan(25)
            expect(ttl).toBeLessThanOrEqual(30)
            expect(await redis.exists(`realtime:ticket:${ticket}`)).toBe(0)
        })

        it('lets in only one of two sockets offering it at once', async () => {
            const ticket = await ticketFor('an')

            const outcomes = await Promise.allSettled([connect(ticket), connect(ticket)])

            expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
        })

        it('is refused the second time', async () => {
            const ticket = await ticketFor('an')
            await connect(ticket)
            await expect(connect(ticket)).rejects.toMatchObject({ type: 'REALTIME_TICKET_INVALID' })
        })

        it('is refused when made up, or missing', async () => {
            await expect(connect(randomUUID())).rejects.toMatchObject({ type: 'REALTIME_TICKET_INVALID' })
            await expect(connect('')).rejects.toMatchObject({ type: 'REALTIME_TICKET_INVALID' })
        })

        it('is refused once its session has ended, though it was never used', async () => {
            const session = await newSession('an')
            const ticket = await ticketWith(session.token)

            expect((await signOut(session.cookie)).status).toBe(200)

            await expect(connect(ticket)).rejects.toMatchObject({ type: 'AUTH_TOKEN_REVOKED' })
        })
    })

    describe('rooms (SRS 5.2, D-163)', () => {
        it('hears its own user room, and no one else does', async () => {
            const an = await connectAs('an')
            const binh = await connectAs('binh')
            const anHears = hears(an, 'probe')
            const binhHears = hears(binh, 'probe')

            publisher.toUser(users.an.id, 'probe', { n: 1 })

            expect(await anHears).toEqual({ n: 1 })
            expect(await binhHears).toBeUndefined()
        })

        it('hears its servers, and the text channels it may view, but not a private one it may not', async () => {
            const { serverId, generalId, secretId } = await serverWith('an', ['binh'])
            const an = await connectAs('an')
            const binh = await connectAs('binh')

            const server = [hears(an, 'probe.server'), hears(binh, 'probe.server')]
            publisher.toServer(serverId, 'probe.server', {})
            expect(await heard(server)).toEqual([true, true])

            const general = [hears(an, 'probe.general'), hears(binh, 'probe.general')]
            publisher.toChannel(generalId, 'probe.general', {})
            expect(await heard(general)).toEqual([true, true])

            const secret = [hears(an, 'probe.secret'), hears(binh, 'probe.secret')]
            publisher.toChannel(secretId, 'probe.secret', {})
            expect(await heard(secret)).toEqual([true, false])
        })

        it('is not put in the rooms of a server it is not in', async () => {
            const { serverId, generalId } = await serverWith('an', [])
            const binh = await connectAs('binh')
            const listening = [hears(binh, 'probe.server'), hears(binh, 'probe.general')]

            publisher.toServer(serverId, 'probe.server', {})
            publisher.toChannel(generalId, 'probe.general', {})

            expect(await heard(listening)).toEqual([false, false])
        })

        it('sends the data with snake_case keys, as the REST API does', async () => {
            const an = await connectAs('an')
            const heard = hears(an, 'probe.case')

            publisher.toUser(users.an.id, 'probe.case', { channelId: 'c1', lastReadId: 'm1' })

            expect(await heard).toEqual({ channel_id: 'c1', last_read_id: 'm1' })
        })
    })

    describe('a session that ends (ARCHITECTURE 3.1 step 5)', () => {
        it('is told session.revoked, then cut off, when it signs out', async () => {
            const session = await newSession('binh')
            const { socket } = await connect(await ticketWith(session.token))
            const revoked = hears(socket, 'session.revoked', 3000)
            const cut = hears(socket, 'disconnect', 3000)

            expect((await signOut(session.cookie)).status).toBe(200)

            expect(await revoked).toBeTruthy()
            expect(await cut).toBe('io server disconnect')
        })

        it('leaves the other sessions of the same person connected', async () => {
            const kept = await connectAs('an')
            const second = await newSession('an')
            const { socket: ending } = await connect(await ticketWith(second.token))
            const keptHears = hears(kept, 'session.revoked')
            const endingHears = hears(ending, 'session.revoked', 3000)

            expect((await signOut(second.cookie)).status).toBe(200)

            expect(await endingHears).toBeTruthy()
            expect(await keptHears).toBeUndefined()
            expect(kept.connected).toBe(true)
        })
    })

    describe('presence (REQ-AUTH-07, D-174)', () => {
        const redis = () => app.get<RedisClientType>(REDIS_CLIENT)
        /** Nothing kept of them: earlier tests leave them online for 60 seconds. */
        async function forget(...who: string[]) {
            for (const id of who.map((name) => users[name].id)) {
                await redis().del(`presence:sockets:${id}`)
                await redis().zRem('presence:seen', id)
                await redis().hDel('presence:shown', id)
            }
        }
        const settings = (who: string, presence: string) =>
            as(who, api().patch('/api/v1/users/me/settings')).send({ presence })
        /** The next presence.updated about `who` that `socket` hears. */
        function hearsPresenceOf(socket: Socket, who: string, within = 2000): Promise<string | undefined> {
            return new Promise((resolve) => {
                const timer = setTimeout(() => resolve(undefined), within)
                const listener = (data: { user_id: string; status: string }) => {
                    if (data.user_id !== users[who].id) return
                    clearTimeout(timer)
                    socket.off('presence.updated', listener)
                    resolve(data.status)
                }
                socket.on('presence.updated', listener)
            })
        }

        beforeEach(() => forget('an', 'binh'))
        afterEach(async () => {
            await settings('an', 'online')
            await forget('an', 'binh')
        })

        /** Makes the two friends, each asking the other from a profile (D-237): no server between them. */
        async function befriend(a: string, b: string) {
            expect((await as(a, api().put(`/api/v1/me/relationships/${users[b].id}`))).status).toBe(200)
            expect((await as(b, api().put(`/api/v1/me/relationships/${users[a].id}`))).body.data.type).toBe('friend')
        }

        it('tells a friend who shares no server when someone comes online (D-242)', async () => {
            await befriend('an', 'binh')
            try {
                const binh = await connectAs('binh')
                const online = hearsPresenceOf(binh, 'an')

                await connect(await ticketFor('an'))

                expect(await online).toBe('online')
            } finally {
                await prisma.relationship.deleteMany({
                    where: { OR: [{ userLowId: users.an.id }, { userHighId: users.an.id }] }
                })
            }
        })

        it('tells both tabs of a new request, each as they see it (relationship.added, SRS 5.2)', async () => {
            const binh = await connectAs('binh')
            const heard = new Promise<{ type: string; user: { id: string } }>((resolve) =>
                binh.once('relationship.added', (data: { relationship: { type: string; user: { id: string } } }) =>
                    resolve(data.relationship)
                )
            )
            try {
                await as('an', api().put(`/api/v1/me/relationships/${users.binh.id}`))
                expect(await heard).toMatchObject({ type: 'incoming', user: { id: users.an.id } })
            } finally {
                await prisma.relationship.deleteMany({
                    where: { OR: [{ userLowId: users.an.id }, { userHighId: users.an.id }] }
                })
                await prisma.notification.deleteMany({ where: { actorId: users.an.id } })
            }
        })

        it('tells the people of its servers when someone comes online, and says it in ready', async () => {
            await serverWith('an', ['binh'])
            const binh = await connectAs('binh')
            const online = hearsPresenceOf(binh, 'an')

            const { ready } = await connect(await ticketFor('an'))

            expect(ready.status).toBe('online')
            expect(await online).toBe('online')
        })

        it('turns away once the tab says it is unused, and online again with it in use', async () => {
            await serverWith('an', ['binh'])
            const an = await connectAs('an')
            const binh = await connectAs('binh')

            const away = hearsPresenceOf(binh, 'an')
            an.emit('presence.idle', { idle: true })
            expect(await away).toBe('idle')

            // Taken once a second per socket (the gateway): a tab flipping it costs nothing more.
            await new Promise((resolve) => setTimeout(resolve, 1100))
            const back = hearsPresenceOf(binh, 'an')
            an.emit('presence.idle', { idle: false })
            expect(await back).toBe('online')
        })

        it('shows invisible as offline to others, at once', async () => {
            await serverWith('an', ['binh'])
            await connectAs('an')
            const binh = await connectAs('binh')
            const hidden = hearsPresenceOf(binh, 'an')

            expect((await settings('an', 'invisible')).status).toBe(200)

            expect(await hidden).toBe('offline')
            expect((await connect(await ticketFor('an'))).ready.status).toBe('offline')
        })

        it('keeps someone whose tabs all closed online for 60 seconds, then the sweep takes them offline', async () => {
            await serverWith('an', ['binh'])
            const an = await connectAs('an')
            const binh = await connectAs('binh')
            const gone = hearsPresenceOf(binh, 'an', 1000)
            an.disconnect()
            expect(await gone).toBeUndefined()
            expect(await redis().hGet('presence:shown', users.an.id)).toBe('online')

            const offline = hearsPresenceOf(binh, 'an')
            await app.get(CommandBus).execute(new SweepPresenceCommand(new Date(Date.now() + 61_000)))

            expect(await offline).toBe('offline')
            expect(await redis().exists(`presence:sockets:${users.an.id}`)).toBe(0)
        })
    })

    describe('typing (REQ-MSG-06)', () => {
        it('tells the channel who is typing, twice in 8 seconds at most from one tab', async () => {
            const { generalId } = await serverWith('an', ['binh'])
            const an = await connectAs('an')
            const binh = await connectAs('binh')

            const first = hears(binh, 'typing.started', 2000)
            an.emit('typing.start', { channel_id: generalId })
            expect(await first).toMatchObject({ channel_id: generalId, user: { id: users.an.id } })

            // Once more at once (the message just sent), then no more.
            const second = hears(binh, 'typing.started', 2000)
            an.emit('typing.start', { channel_id: generalId })
            expect(await second).toBeTruthy()
            const third = hears(binh, 'typing.started')
            an.emit('typing.start', { channel_id: generalId })
            expect(await third).toBeUndefined()
        })

        it('tells nothing about a channel one may not see, or a malformed signal', async () => {
            const { secretId } = await serverWith('an', ['binh'])
            const an = await connectAs('an')
            const binh = await connectAs('binh')
            const listening = hears(an, 'typing.started')

            binh.emit('typing.start', { channel_id: secretId })
            binh.emit('typing.start', { channel_id: 'not-an-id' })

            expect(await listening).toBeUndefined()
            expect(binh.connected).toBe(true)
        })
    })

    describe('live changes to servers (D-178)', () => {
        const send = (who: string, method: 'post' | 'patch' | 'put' | 'delete', path: string, body: object = {}) =>
            as(who, api()[method](`/api/v1/servers/${path}`))
                .set('Idempotency-Key', randomUUID())
                .send(body)

        /** Whether each socket hears a probe sent to the room right now. */
        async function inRoom(sockets: Socket[], send: (event: string) => void) {
            const event = `probe.${randomUUID().slice(0, 8)}`
            const listening = sockets.map((socket) => hears(socket, event))
            send(event)
            return heard(listening)
        }

        /** Whether the socket stops hearing the room within two seconds. */
        async function outWithin(socket: Socket, send: (event: string) => void) {
            const until = Date.now() + 2000
            while (Date.now() < until) if (!(await inRoom([socket], send))[0]) return true
            return false
        }

        it('puts someone who joins in the rooms of the server first, then tells everyone in it', async () => {
            const { serverId, generalId } = await serverWith('an', [])
            const an = await connectAs('an')
            const binh = await connectAs('binh')
            const invite = await send('an', 'post', `${serverId}/invites`, { max_age_seconds: null, max_uses: null })
            const told = [hears(an, 'member.joined', 3000), hears(binh, 'member.joined', 3000)]

            const joined = await as('binh', api().post(`/api/v1/invites/${invite.body.data.code}/accept`))

            expect(joined.status).toBe(200)
            const news = { server_id: serverId, user_id: users.binh.id }
            expect(await Promise.all(told)).toEqual([news, news])
            expect(await inRoom([binh], (event) => publisher.toChannel(generalId, event, {}))).toEqual([true])
        })

        it('tells the one kicked why, takes them out of the server and its channels, and tells the others without why', async () => {
            const { serverId, generalId } = await serverWith('an', ['binh'])
            const an = await connectAs('an')
            const binh = await connectAs('binh')
            const toBinh = hears(binh, 'member.left', 3000)
            const toAn = hears(an, 'member.left', 3000)

            const kicked = await as('an', api().delete(`/api/v1/servers/${serverId}/members/${users.binh.id}`)).send({
                reason: 'Spam'
            })

            expect(kicked.status).toBe(200)
            expect(await toBinh).toEqual({
                server_id: serverId,
                user_id: users.binh.id,
                removed_by: 'kick',
                reason: 'Spam'
            })
            expect(await toAn).toEqual({ server_id: serverId, user_id: users.binh.id })
            expect(await inRoom([binh], (event) => publisher.toServer(serverId, event, {}))).toEqual([false])
            expect(await inRoom([binh], (event) => publisher.toChannel(generalId, event, {}))).toEqual([false])
        })

        it('moves a member into a private channel when it opens to everyone, and out when it closes again', async () => {
            const { serverId, secretId } = await serverWith('an', ['binh'])
            const binh = await connectAs('binh')
            const probeSecret = (event: string) => publisher.toChannel(secretId, event, {})

            const opened = hears(binh, 'channel.updated', 3000)
            expect((await send('an', 'patch', `${serverId}/channels/${secretId}`, { is_private: false })).status).toBe(
                200
            )
            expect(await opened).toEqual({ server_id: serverId })
            expect(await inRoom([binh], probeSecret)).toEqual([true])

            const closed = hears(binh, 'channel.updated', 3000)
            const shut = await send('an', 'patch', `${serverId}/channels/${secretId}`, {
                is_private: true,
                view_role_ids: []
            })
            expect(shut.status).toBe(200)
            expect(await closed).toEqual({ server_id: serverId })
            expect(await inRoom([binh], probeSecret)).toEqual([false])
        })

        it('moves only the member given a role that may view a private channel', async () => {
            const { serverId, secretId } = await serverWith('an', ['binh'])
            const role = await send('an', 'post', `${serverId}/roles`, { name: 'Ban cán sự' })
            const roleId: string = role.body.data.role_id
            await send('an', 'patch', `${serverId}/channels/${secretId}`, { is_private: true, view_role_ids: [roleId] })
            const binh = await connectAs('binh')
            const updated = hears(binh, 'member.updated', 3000)

            expect(
                (await send('an', 'put', `${serverId}/roles/${roleId}/members`, { user_ids: [users.binh.id] })).status
            ).toBe(200)

            expect(await updated).toEqual({ server_id: serverId, user_id: users.binh.id })
            expect(await inRoom([binh], (event) => publisher.toChannel(secretId, event, {}))).toEqual([true])
        })

        it('tells a new channel, a new role and a new invite by the server alone, naming nothing', async () => {
            const { serverId } = await serverWith('an', ['binh'])
            const an = await connectAs('an')
            const binh = await connectAs('binh')
            const told = [
                hears(binh, 'channel.created', 3000),
                hears(an, 'role.created', 3000),
                hears(an, 'invite.created', 3000)
            ]

            await send('an', 'post', `${serverId}/channels`, {
                type: 'text',
                name: 'bi-mat',
                is_private: true,
                view_role_ids: []
            })
            await send('an', 'post', `${serverId}/roles`, { name: 'Nhóm đề' })
            await send('an', 'post', `${serverId}/invites`, { max_age_seconds: 3600, max_uses: 5 })

            const news = { server_id: serverId }
            expect(await Promise.all(told)).toEqual([news, news, news])
        })

        it('tells everyone a server was deleted, then takes their sockets out of its rooms', async () => {
            const { serverId, generalId } = await serverWith('an', ['binh'])
            const binh = await connectAs('binh')
            const told = hears(binh, 'server.deleted', 3000)

            const deleted = await as('an', api().delete(`/api/v1/servers/${serverId}`)).send({
                name: 'Ôn thi Giải tích 2'
            })

            expect(deleted.status).toBe(200)
            expect(await told).toEqual({ server_id: serverId })
            // Told first, then moved: give the move a moment.
            expect(await outWithin(binh, (event) => publisher.toServer(serverId, event, {}))).toBe(true)
            expect(await inRoom([binh], (event) => publisher.toChannel(generalId, event, {}))).toEqual([false])
        })
    })
})
