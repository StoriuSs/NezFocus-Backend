import { createHash, randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { getQueueToken } from '@nestjs/bullmq'
import { CommandBus, EventBus } from '@nestjs/cqrs'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Queue } from 'bullmq'
import { AccessToken, TokenVerifier } from 'livekit-server-sdk'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { AccountDeletionRequestedEvent, SessionsEndedEvent } from '@/modules/auth'
import { SweepCallTimersCommand } from '@/modules/social'
import { CALL_JOBS, CallJobsPort } from '@/modules/social/application'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { livekitTarget, testClientIp } from './targets'

/**
 * One-to-one calls through the whole app (REQ-SOCIAL-05, SOCIAL-06, SRS
 * 5.1, 5.2, ARCHITECTURE 6, D-120, D-242, D-245): calling, ringing every
 * tab, answering, declining, hanging up; busy, two calling each other at
 * once, two calls to one person; 45 seconds of ringing on a clock moved by
 * the test, and across a restart (NFR-REL-02); the call's message in the
 * DM and the missed call's inbox item; a block or an account deletion
 * cutting a call off. Its media (L4b, D-239, D-242, D-246): the token to
 * its LiveKit room, LiveKit's webhooks of that room (signed by the test with
 * the key pair of the LiveKit of test:services:up, as in voice-http: a real
 * participant needs a WebRTC client), 15 seconds to connect and 30 to come
 * back, one media connection per account with voice rooms, an ended
 * session put out.
 *
 * Requires Postgres, Redis, Mailpit and LiveKit: `pnpm test:services:up`,
 * then `pnpm test:integration`.
 */
describe('Calls (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-call-${randomUUID().slice(0, 8)}`
    type Who = 'an' | 'binh' | 'chi' | 'dung'
    const PEOPLE: Who[] = ['an', 'binh', 'chi', 'dung']

    let app: NestExpressApplication
    let prisma: PrismaService
    let socketUrl: string
    const users = {} as Record<Who, { id: string; token: string }>
    const opened: Socket[] = []

    const api = () => request(app.getHttpServer())
    const as = (who: Who, req: request.Test) =>
        req.set('Authorization', `Bearer ${users[who].token}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const callQueue = () => app.get<Queue>(getQueueToken(QUEUES.SOCIAL))

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

    /** Friends: they may call each other. */
    async function befriend(a: Who, b: Who) {
        const [low, high] = [users[a].id, users[b].id].sort()
        await prisma.relationship.create({
            data: {
                userLowId: low!,
                userHighId: high!,
                requesterId: users[a].id,
                status: 'accepted',
                acceptedAt: new Date()
            }
        })
    }
    /** Friends with a DM, opened by `a`: its id. */
    async function dmOf(a: Who, b: Who): Promise<string> {
        await befriend(a, b)
        const res = await as(a, api().post('/api/v1/me/dms'))
            .set('Idempotency-Key', randomUUID())
            .send({ user_id: users[b].id })
        expect(res.status).toBe(200)
        return res.body.data.id
    }
    const call = (who: Who, dmId: string, video = false) =>
        as(who, api().post(`/api/v1/dms/${dmId}/calls`))
            .set('Idempotency-Key', randomUUID())
            .send({ video })
    const act = (who: Who, callId: string, action: 'accept' | 'decline' | 'end') =>
        as(who, api().post(`/api/v1/calls/${callId}/${action}`))
    const mine = async (who: Who) => (await as(who, api().get('/api/v1/me/call'))).body.data
    const messagesOf = async (who: Who, dmId: string) =>
        (await as(who, api().get(`/api/v1/channels/${dmId}/messages`))).body.data.items as Record<string, unknown>[]
    const inbox = async (who: Who) =>
        (await as(who, api().get('/api/v1/me/notifications'))).body.data as {
            items: Record<string, unknown>[]
            unread_count: number
        }
    /** Moves the clock: runs the sweep as if `seconds` had passed since now. */
    const after = (seconds: number) =>
        app.get(CommandBus).execute(new SweepCallTimersCommand(new Date(Date.now() + seconds * 1000)))

    /** Effects after commit (messages, items, events) come a moment later: wait for them. */
    async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
        for (let tries = 0; ; tries++) {
            const value = await read()
            if (done(value) || tries > 60) return value
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
    }

    async function connectAs(who: Who): Promise<Socket> {
        const ticket = (await as(who, api().post('/api/v1/realtime/ticket'))).body.data.ticket as string
        const socket = io(socketUrl, {
            auth: { ticket },
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
            extraHeaders: { Origin: FRONTEND }
        })
        opened.push(socket)
        await new Promise((resolve) => socket.once('ready', resolve))
        return socket
    }
    /** What `socket` hears of `event` within a short wait; undefined when nothing. */
    function hears(socket: Socket, event: string, within = 1500): Promise<Record<string, unknown> | undefined> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(undefined), within)
            socket.once(event, (data: Record<string, unknown>) => {
                clearTimeout(timer)
                resolve(data)
            })
        })
    }

    beforeAll(async () => {
        app = await bootApp()
        await app.listen(0)
        socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
        prisma = app.get(PrismaService)
        for (const who of PEOPLE) await signUp(who)
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.channel
            .deleteMany({ where: { dm: { OR: [{ userLowId: { in: ids } }, { userHighId: { in: ids } }] } } })
            .catch(() => undefined)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    afterEach(async () => {
        for (const socket of opened.splice(0)) socket.disconnect()
        const ids = Object.values(users).map((user) => user.id)
        // Let the effects of the last change land before clearing.
        await new Promise((resolve) => setTimeout(resolve, 200))
        await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } })
        await prisma.user.updateMany({ where: { id: { in: ids } }, data: { deletionRequestedAt: null } })
        await prisma.relationship.deleteMany({ where: { userLowId: { in: ids } } })
        await prisma.block.deleteMany({ where: { blockerId: { in: ids } } })
        // A DM's channel takes its DmChannel, calls and messages with it.
        await prisma.channel.deleteMany({
            where: { dm: { OR: [{ userLowId: { in: ids } }, { userHighId: { in: ids } }] } }
        })
    })

    describe('done when (ROADMAP M6): nobody answers, the callee gets a missed call', () => {
        it('rings every tab of the callee, and 45 seconds on misses it with a message and an inbox item', async () => {
            const dm = await dmOf('an', 'binh')
            const tab1 = await connectAs('binh')
            const tab2 = await connectAs('binh')
            const ringing = [hears(tab1, 'call.ringing'), hears(tab2, 'call.ringing')]

            const res = await call('an', dm, true)

            expect(res.status).toBe(201)
            const made = res.body.data
            expect(made).toMatchObject({
                dm_id: dm,
                caller_id: users.an.id,
                callee_id: users.binh.id,
                video: true,
                status: 'ringing',
                end_reason: null,
                user: { id: users.binh.id },
                accepted_at: null,
                ended_at: null
            })
            for (const heard of await Promise.all(ringing)) {
                expect(heard).toMatchObject({ call: { id: made.id, user: { id: users.an.id } } })
            }
            expect(await mine('an')).toMatchObject({ current: { id: made.id }, incoming: [] })
            expect(await mine('binh')).toMatchObject({ current: null, incoming: [{ id: made.id }] })
            const job = await callQueue().getJob(`call-${made.id}-ring-0`)
            expect(job?.data).toEqual({ callId: made.id, version: 0 })
            expect(job?.opts.delay).toBeGreaterThan(40_000)

            // B never answers (the tab closed): 45 seconds pass.
            await after(46)

            expect(await prisma.call.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({
                status: 'missed',
                endReason: 'no_answer'
            })
            const said = await eventually(
                () => messagesOf('binh', dm),
                (items) => items.some((item) => item.system_event === 'call_ended')
            )
            const notice = said.find((item) => item.system_event === 'call_ended')!
            expect(notice).toMatchObject({
                type: 'system',
                author: null,
                system_data: {
                    user_id: users.an.id,
                    call_id: made.id,
                    status: 'missed',
                    end_reason: 'no_answer',
                    video: true,
                    duration_seconds: null
                }
            })
            const items = await eventually(
                () => inbox('binh'),
                (box) => box.items.length > 0
            )
            expect(items.items).toEqual([
                expect.objectContaining({
                    type: 'missed_call',
                    server_id: null,
                    channel_id: dm,
                    message_id: notice.id,
                    actor: expect.objectContaining({ id: users.an.id })
                })
            ])
            expect(items.unread_count).toBe(1)
            expect((await inbox('an')).items).toEqual([])
            expect(await mine('binh')).toEqual({ current: null, incoming: [] })

            // Opening the DM reads the item with it.
            await as('binh', api().post(`/api/v1/channels/${dm}/ack`)).send({ message_id: notice.id })
            expect(
                (
                    await eventually(
                        () => inbox('binh'),
                        (box) => box.unread_count === 0
                    )
                ).unread_count
            ).toBe(0)
        })

        it('shows the DM again on the callee’s side with the missed call, unread for them only (D-244)', async () => {
            const dm = await dmOf('an', 'binh')
            const made = (await call('an', dm)).body.data

            await act('an', made.id, 'end')

            const theirs = await eventually(
                async () =>
                    (await as('binh', api().get('/api/v1/me/read-states'))).body.data.items as Record<
                        string,
                        unknown
                    >[],
                (states) => states.some((state) => state.channel_id === dm)
            )
            expect(theirs).toContainEqual(expect.objectContaining({ channel_id: dm, server_id: null, unread_count: 1 }))
            const own = (await as('an', api().get('/api/v1/me/read-states'))).body.data.items as Record<
                string,
                unknown
            >[]
            expect(own.find((state) => state.channel_id === dm)).toMatchObject({ unread_count: 0 })
        })
    })

    describe('answering, declining, hanging up', () => {
        it('answers: active for both, the caller’s tabs told; ended with its length', async () => {
            const dm = await dmOf('an', 'binh')
            const callerTab = await connectAs('an')
            const made = (await call('an', dm)).body.data
            const told = hears(callerTab, 'call.updated')

            const answered = await act('binh', made.id, 'accept')

            expect(answered.status).toBe(200)
            expect(answered.body.data).toMatchObject({ status: 'active', accepted_at: expect.any(String) })
            expect(await told).toMatchObject({ call: { id: made.id, status: 'active' } })
            expect(await mine('binh')).toMatchObject({ current: { id: made.id, status: 'active' }, incoming: [] })
            expect(await callQueue().getJob(`call-${made.id}-ring-0`)).toBeUndefined()

            const ended = await act('an', made.id, 'end')

            expect(ended.body.data).toMatchObject({ status: 'ended', end_reason: null, ended_at: expect.any(String) })
            const said = await eventually(
                () => messagesOf('an', dm),
                (items) => items.some((item) => item.system_event === 'call_ended')
            )
            expect(said.find((item) => item.system_event === 'call_ended')).toMatchObject({
                system_data: { status: 'ended', duration_seconds: expect.any(Number) }
            })
            expect((await inbox('binh')).items).toEqual([])
        })

        it('declines with no inbox item (SOCIAL-06); the caller cancelling gives one', async () => {
            const dm = await dmOf('an', 'binh')
            const declined = (await call('an', dm)).body.data
            expect((await act('binh', declined.id, 'decline')).body.data).toMatchObject({ status: 'declined' })

            const cancelled = (await call('an', dm)).body.data
            expect((await act('an', cancelled.id, 'end')).body.data).toMatchObject({
                status: 'missed',
                end_reason: 'cancelled'
            })

            const box = await eventually(
                () => inbox('binh'),
                (found) => found.items.length > 0
            )
            expect(box.items.map((item) => item.type)).toEqual(['missed_call'])
        })

        it('answers a command that came late with the call as it is (D-245); others find no call', async () => {
            const dm = await dmOf('an', 'binh')
            const made = (await call('an', dm)).body.data
            await act('an', made.id, 'end')

            const late = await act('binh', made.id, 'accept')

            expect(late.status).toBe(200)
            expect(late.body.data).toMatchObject({ status: 'missed', end_reason: 'cancelled' })
            for (const res of [await act('chi', made.id, 'end'), await act('an', randomUUID(), 'end')]) {
                expect([res.status, res.body.meta.type]).toEqual([404, 'NOT_FOUND_ERROR'])
            }
        })
    })

    describe('busy and at once (D-120, D-242, D-245)', () => {
        it('makes a call to someone in a call missed at once (busy): no ring, an item for them', async () => {
            const anBinh = await dmOf('an', 'binh')
            const chiBinh = await dmOf('chi', 'binh')
            const talking = (await call('an', anBinh)).body.data
            await act('binh', talking.id, 'accept')
            const binhTab = await connectAs('binh')
            const ring = hears(binhTab, 'call.ringing', 800)

            const busy = await call('chi', chiBinh)

            expect(busy.status).toBe(201)
            expect(busy.body.data).toMatchObject({ status: 'missed', end_reason: 'busy' })
            expect(await ring).toBeUndefined()
            expect(await mine('chi')).toEqual({ current: null, incoming: [] })
            const box = await eventually(
                () => inbox('binh'),
                (found) => found.items.length > 0
            )
            expect(box.items).toEqual([expect.objectContaining({ type: 'missed_call', channel_id: chiBinh })])
        })

        it('meets two calling each other at once in one call, answered', async () => {
            const dm = await dmOf('an', 'binh')

            const [a, b] = await Promise.all([call('an', dm), call('binh', dm)])

            expect(a.body.data.id).toBe(b.body.data.id)
            expect(await prisma.call.findMany({ where: { dmChannelId: dm } })).toEqual([
                expect.objectContaining({ status: 'active' })
            ])
        })

        it('rings two calls to one person; answering one misses the other as busy; a third finds them busy', async () => {
            const anBinh = await dmOf('an', 'binh')
            const chiBinh = await dmOf('chi', 'binh')
            const dungBinh = await dmOf('dung', 'binh')
            const first = (await call('an', anBinh)).body.data
            const second = (await call('chi', chiBinh)).body.data
            expect(second.status).toBe('ringing')

            const third = await call('dung', dungBinh)
            expect(third.body.data).toMatchObject({ status: 'missed', end_reason: 'busy' })
            expect((await mine('binh')).incoming.map((one: { id: string }) => one.id)).toEqual([first.id, second.id])

            await act('binh', first.id, 'accept')

            expect(await prisma.call.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
                status: 'missed',
                endReason: 'busy'
            })
        })

        it('locks by person, not by DM: one calling while called in another DM is never both', async () => {
            const anBinh = await dmOf('an', 'binh')
            const binhChi = await dmOf('binh', 'chi')

            await Promise.all([call('an', anBinh), call('binh', binhChi)])

            // Either Bình rang first (An finds them busy) or An rang first (Bình calling out misses it).
            const ringing = await prisma.call.findMany({
                where: { dmChannelId: { in: [anBinh, binhChi] }, status: 'ringing' }
            })
            expect(ringing).toHaveLength(1)
        })

        it('rings at most two of three calling one person at once; the third finds them busy', async () => {
            const dms = await Promise.all((['an', 'chi', 'dung'] as Who[]).map((who) => dmOf(who, 'binh')))

            const made = await Promise.all((['an', 'chi', 'dung'] as Who[]).map((who, index) => call(who, dms[index]!)))

            const statuses = made.map((res) => res.body.data.status as string).sort()
            expect(statuses).toEqual(['missed', 'ringing', 'ringing'])
            expect(made.find((res) => res.body.data.status === 'missed')!.body.data.end_reason).toBe('busy')
        })

        it('refuses a caller already in a call with CALL_IN_PROGRESS', async () => {
            const anBinh = await dmOf('an', 'binh')
            const anChi = await dmOf('an', 'chi')
            await call('an', anBinh)

            const res = await call('an', anChi)

            expect([res.status, res.body.meta.type, res.body.meta.code]).toEqual([409, 'CALL_IN_PROGRESS', '409922'])
        })

        it('takes an answer and a hang-up at the same moment one after the other: one end, one message', async () => {
            const dm = await dmOf('an', 'binh')
            const made = (await call('an', dm)).body.data

            const answers = await Promise.all([act('binh', made.id, 'accept'), act('an', made.id, 'end')])

            // The second waits for the first and reads what it wrote: never a write over it (500).
            expect(answers.map((res) => res.status)).toEqual([200, 200])
            const row = await prisma.call.findUniqueOrThrow({ where: { id: made.id } })
            expect(['ended', 'missed']).toContain(row.status)
            const said = await eventually(
                () => messagesOf('an', dm),
                (items) => items.some((item) => item.system_event === 'call_ended')
            )
            expect(said.filter((item) => item.system_event === 'call_ended')).toHaveLength(1)
        })
    })

    describe('who may call (REQ-SOCIAL-05, D-242)', () => {
        it('refuses across a block with the one answer, and finds no DM of others', async () => {
            const dm = await dmOf('an', 'binh')
            const chiDung = await dmOf('chi', 'dung')
            await prisma.block.create({ data: { blockerId: users.binh.id, blockedId: users.an.id } })

            const blocked = await call('an', dm)
            const notMine = await call('an', chiDung)

            expect([blocked.status, blocked.body.meta.type, blocked.body.meta.code]).toEqual([
                403,
                'CANNOT_MESSAGE_USER',
                '403920'
            ])
            expect([notMine.status, notMine.body.meta.type]).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('ends a call at once when one blocks the other, and when one starts to wait for deletion', async () => {
            const anBinh = await dmOf('an', 'binh')
            const chiDung = await dmOf('chi', 'dung')
            const first = (await call('an', anBinh)).body.data
            await act('binh', first.id, 'accept')
            const second = (await call('chi', chiDung)).body.data
            await act('dung', second.id, 'accept')

            const blocked = await as('binh', api().put(`/api/v1/me/blocks/${users.an.id}`))
            expect(blocked.status).toBe(200)
            app.get(EventBus).publish(new AccountDeletionRequestedEvent(users.dung.id))

            for (const id of [first.id, second.id]) {
                const row = await eventually(
                    () => prisma.call.findUniqueOrThrow({ where: { id } }),
                    (found) => found.status !== 'active'
                )
                expect(row.status).toBe('ended')
            }
        })
    })

    describe('its media: the LiveKit room of a call (L4b, D-239, D-242, D-246)', () => {
        const join = (who: Who, callId: string) => as(who, api().post(`/api/v1/calls/${callId}/join`))
        const claimsOf = (token: string) =>
            new TokenVerifier(livekitTarget.apiKey, livekitTarget.apiSecret).verify(token)
        /** A call from An to Bình, answered: its id. */
        async function answered(): Promise<{ dm: string; id: string }> {
            const dm = await dmOf('an', 'binh')
            const id = (await call('an', dm)).body.data.id as string
            expect((await act('binh', id, 'accept')).body.data.status).toBe('active')
            return { dm, id }
        }

        /** A webhook of the call's room as LiveKit sends it: signed, the body as text. */
        async function roomHook(
            kind: 'participant_joined' | 'participant_left',
            who: Who,
            callId: string,
            sid: string,
            sessionId?: string,
            room = `call:${callId}`
        ) {
            const joinedAt = new Date()
            const body = JSON.stringify({
                event: kind,
                id: `EV_${randomUUID()}`,
                createdAt: String(Math.floor(Date.now() / 1000)),
                room: { sid: 'RM_test', name: room },
                participant: {
                    sid,
                    identity: users[who].id,
                    joinedAt: String(Math.floor(joinedAt.getTime() / 1000)),
                    joinedAtMs: String(joinedAt.getTime()),
                    ...(sessionId ? { attributes: { session_id: sessionId } } : {})
                }
            })
            const signer = new AccessToken(livekitTarget.apiKey, livekitTarget.apiSecret)
            signer.sha256 = createHash('sha256').update(body).digest('base64')
            const res = await api()
                .post('/api/v1/voice/livekit-webhook')
                .set('X-Forwarded-For', CLIENT_IP)
                .set('Content-Type', 'application/webhook+json')
                .set('Authorization', await signer.toJwt())
                .send(body)
            expect(res.status).toBe(200)
        }
        const joins = (who: Who, callId: string, sid = `PA_${who}`, sessionId?: string) =>
            roomHook('participant_joined', who, callId, sid, sessionId)
        const leaves = (who: Who, callId: string, sid = `PA_${who}`) => roomHook('participant_left', who, callId, sid)
        /** The call's CallParticipant rows once `count` are there (the webhook is heard after it answers). */
        const rowsOf = (callId: string, count: number) =>
            eventually(
                () => prisma.callParticipant.findMany({ where: { callId }, orderBy: { joinedAt: 'asc' } }),
                (rows) => rows.length >= count
            )

        it('gives each of an active call a token to its room, microphone and camera, with their session', async () => {
            const { id } = await answered()

            const res = await join('binh', id)

            expect(res.status).toBe(200)
            expect(res.body.data).toMatchObject({ call: { id, status: 'active' }, media: { url: livekitTarget.url } })
            const claims = await claimsOf(res.body.data.media.token)
            expect(claims).toMatchObject({ sub: users.binh.id, attributes: { session_id: expect.any(String) } })
            expect(claims.video).toMatchObject({
                roomJoin: true,
                room: `call:${id}`,
                canPublishSources: ['microphone', 'camera'],
                canPublishData: false
            })
            // Answering set the 15 seconds, at the version it made.
            const job = await callQueue().getJob(`call-${id}-media-1`)
            expect(job?.data).toEqual({ callId: id, version: 1 })
            expect(job?.opts.delay).toBeGreaterThan(10_000)
        })

        it('gives no token for a call ringing or over (200, its status), and finds none for someone not of it', async () => {
            const dm = await dmOf('an', 'binh')
            const id = (await call('an', dm)).body.data.id as string

            const ringing = await join('an', id)
            expect(ringing.status).toBe(200)
            expect(ringing.body.data).toMatchObject({ call: { id, status: 'ringing' }, media: null })
            expect((await join('chi', id)).status).toBe(404)

            await act('an', id, 'end')
            expect((await join('binh', id)).body.data).toMatchObject({ call: { status: 'missed' }, media: null })
        })

        it('fails a call nobody connected to 15 seconds after answering: no length (D-120)', async () => {
            const { dm, id } = await answered()
            await joins('an', id)
            await rowsOf(id, 1)

            await after(16)

            const row = await prisma.call.findUniqueOrThrow({ where: { id } })
            expect(row).toMatchObject({ status: 'failed', endReason: null })
            const message = await eventually(
                () => messagesOf('an', dm),
                (items) => items.length > 0
            )
            expect(message[0]).toMatchObject({ system_event: 'call_ended', system_data: { status: 'failed' } })
            expect((message[0].system_data as Record<string, unknown>).duration_seconds).toBeNull()
        })

        it('ends a call 30 seconds after one of the two left, at the time they left', async () => {
            const { id } = await answered()
            await joins('an', id)
            await joins('binh', id)
            await rowsOf(id, 2)
            const before = new Date()
            await leaves('binh', id)
            const left = await eventually(
                () =>
                    prisma.callParticipant.findUniqueOrThrow({
                        where: { callId_userId: { callId: id, userId: users.binh.id } }
                    }),
                (one) => one.leftAt !== null
            )
            expect(left.leftAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)

            await after(31)

            expect(await prisma.call.findUniqueOrThrow({ where: { id } })).toMatchObject({
                status: 'ended',
                endedAt: left.leftAt
            })
        })

        it('keeps a call one of the two came back to within 30 seconds (a reload)', async () => {
            const { id } = await answered()
            await joins('an', id)
            await joins('binh', id)
            await rowsOf(id, 2)
            await leaves('binh', id)
            await joins('binh', id, 'PA_binh_reloaded')
            await eventually(
                () =>
                    prisma.callParticipant.findUniqueOrThrow({
                        where: { callId_userId: { callId: id, userId: users.binh.id } }
                    }),
                (one) => one.participantSid === 'PA_binh_reloaded'
            )

            await after(31)

            expect((await prisma.call.findUniqueOrThrow({ where: { id } })).status).toBe('active')
            await act('an', id, 'end')
        })

        it('writes nothing for someone not of the call joining its room, nor anyone joining a call over', async () => {
            const { id } = await answered()
            await joins('chi', id)
            await act('an', id, 'end')
            await joins('binh', id)
            await new Promise((resolve) => setTimeout(resolve, 300))

            expect(await prisma.callParticipant.findMany({ where: { callId: id } })).toEqual([])
        })

        it('keeps one media connection per account: a voice room ends my call, a call takes me out of my voice room', async () => {
            const created = await as('an', api().post('/api/v1/servers'))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Nhóm học Giải tích', template: 'standard' })
            const serverId = created.body.data.id as string
            const room = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'voice', name: 'Phòng ôn thi', is_private: false, view_role_ids: [] })
            const roomId = room.body.data.id as string

            const first = await answered()
            const token = await as('an', api().post('/api/v1/voice/token')).send({ channel_id: roomId })
            expect(token.status).toBe(201)
            expect(await prisma.call.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'ended' })

            await prisma.voiceState.create({
                data: { userId: users.an.id, channelId: roomId, participantSid: 'PA_room', joinedAt: new Date() }
            })
            const second = (await call('an', first.dm)).body.data.id as string
            await act('binh', second, 'accept')
            expect((await join('an', second)).body.data.media).not.toBeNull()
            expect(await prisma.voiceState.findUnique({ where: { userId: users.an.id } })).toBeNull()

            // A voice token taken before the call was answered in another tab, used now: the call ends.
            await roomHook('participant_joined', 'an', second, 'PA_room_2', undefined, `voice:${roomId}`)
            expect(await prisma.call.findUniqueOrThrow({ where: { id: second } })).toMatchObject({ status: 'ended' })
        })

        it('marks out the call connection of a session that ended: 30 seconds to come back (D-214)', async () => {
            const { id } = await answered()
            const token = (await join('an', id)).body.data.media.token as string
            const sessionId = (await claimsOf(token)).attributes!.session_id!
            await joins('an', id, 'PA_an', sessionId)
            await joins('binh', id)
            await rowsOf(id, 2)

            app.get(EventBus).publish(new SessionsEndedEvent([sessionId]))

            const row = await eventually(
                () =>
                    prisma.callParticipant.findUniqueOrThrow({
                        where: { callId_userId: { callId: id, userId: users.an.id } }
                    }),
                (one) => one.leftAt !== null
            )
            expect(row.leftAt).not.toBeNull()
            await after(31)
            expect((await prisma.call.findUniqueOrThrow({ where: { id } })).status).toBe('ended')
        })
    })

    describe('the study activity line and calls (M6 L5, D-240, D-247)', () => {
        afterEach(async () => {
            await prisma.focusSession.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } })
        })

        it('tells friends a Solo, hides it while its person is in a call, and tells it again once the call is over', async () => {
            const dm = await dmOf('an', 'binh')
            await befriend('an', 'chi')
            const chiTab = await connectAs('chi')
            /** The next line Chi hears of An. */
            const lineOfAn = () => hears(chiTab, 'activity.updated')

            const started = lineOfAn()
            const solo = await as('an', api().post('/api/v1/me/solo-session'))
                .set('Idempotency-Key', randomUUID())
                .send({})
            expect(solo.status).toBe(201)
            expect(await started).toEqual({
                user_id: users.an.id,
                activity: { room: null, solo: { status: 'running', phase: 'focus', phase_ends_at: expect.any(String) } }
            })

            const made = (await call('an', dm)).body.data.id as string
            const hidden = lineOfAn()
            await act('binh', made, 'accept')
            expect(await hidden).toEqual({ user_id: users.an.id, activity: null })
            const list = await as('chi', api().get('/api/v1/me/relationships'))
            const an = (list.body.data.relationships as { user: { id: string }; activity: unknown }[]).find(
                (entry) => entry.user.id === users.an.id
            )
            expect(an?.activity).toBeNull()

            const shown = lineOfAn()
            await act('an', made, 'end')
            expect(await shown).toMatchObject({ user_id: users.an.id, activity: { solo: { status: 'running' } } })
        })
    })

    describe('a job across a restart (NFR-REL-02)', () => {
        it('misses a call whose job was set before the app stopped, once it is back', async () => {
            const dm = await dmOf('an', 'binh')
            const id = (await call('an', dm)).body.data.id as string
            // Due in 2 seconds: its job, set again for then, waits in Redis while no app runs.
            await callQueue().remove(`call-${id}-ring-0`)
            await app.get<CallJobsPort>(CALL_JOBS).ringOutAt(id, 0, new Date(Date.now() + 2000))

            for (const socket of opened.splice(0)) socket.disconnect()
            await closeApp(app)
            await new Promise((resolve) => setTimeout(resolve, 3000))
            app = await bootApp()
            prisma = app.get(PrismaService)

            const row = await eventually(
                () => prisma.call.findUniqueOrThrow({ where: { id } }),
                (found) => found.status !== 'ringing'
            )
            expect(row).toMatchObject({ status: 'missed', endReason: 'no_answer', version: 1 })
        })
    })
})
