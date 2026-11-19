import { createHash, randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { ConfigService } from '@nestjs/config'
import { CommandBus } from '@nestjs/cqrs'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AccessToken, TokenVerifier } from 'livekit-server-sdk'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { MEDIA_ROOMS, MediaRoomsPort, ReconcileVoiceRoomsCommand } from '@/modules/voice/application'
import { joinWrite, leaveWrite, VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '@/modules/voice/domain'
import { LiveKitMediaRooms } from '@/modules/voice/infrastructure'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { livekitTarget, testClientIp } from './targets'

/**
 * Voice rooms through the whole app (REQ-VC-01 to 05, SRS 5.1, D-204 to
 * D-210): who is in which room, kept in VoiceState, and the LiveKit behind
 * MEDIA_ROOMS; the tokens to join, by permission; LiveKit's webhooks,
 * signed, sent again and out of order; one connection per account; the
 * people of each room in GET /servers and voice_state.updated (D-205); the
 * reconciliation; a tab's microphone and camera (D-206); moderators muting
 * and putting people out, and the server putting them out (D-207, D-212).
 *
 * The webhooks here are signed by the test with the key pair of the LiveKit
 * of test:services:up, as LiveKit signs them: a real participant needs a
 * WebRTC client, which Node has not.
 *
 * Requires Postgres, Redis, Mailpit and LiveKit: `pnpm test:services:up`,
 * then `pnpm test:integration`.
 */
describe('Voice rooms (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-voice-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi' | 'dung' | 'em'

    let app: NestExpressApplication
    let prisma: PrismaService
    let socketUrl: string
    const opened: Socket[] = []
    const users = {} as Record<Who, { token: string; id: string }>
    let serverId: string
    let roomId: string
    let otherRoomId: string
    let privateRoomId: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]

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

    /** The Authorization LiveKit sends: a JWT of its key pair holding the sha256 of the body. */
    async function signatureOf(body: string, secret = livekitTarget.apiSecret) {
        const signer = new AccessToken(livekitTarget.apiKey, secret)
        signer.sha256 = createHash('sha256').update(body).digest('base64')
        return signer.toJwt()
    }

    /** A webhook as LiveKit sends it: the body as text, its type application/webhook+json. */
    const sendHook = (body: string, authorization?: string) => {
        const req = anyone(api().post('/api/v1/voice/livekit-webhook')).set('Content-Type', 'application/webhook+json')
        return (authorization ? req.set('Authorization', authorization) : req).send(body)
    }
    const webhook = async (event: object, secret?: string) => {
        const body = JSON.stringify(event)
        return sendHook(body, await signatureOf(body, secret))
    }

    /** participant_joined / participant_left of `who`'s connection `sid` to a room, with a fresh event id. */
    const participantEvent = (
        kind: 'participant_joined' | 'participant_left',
        who: Who,
        channelId: string,
        sid: string,
        joinedAt: Date
    ) => ({
        event: kind,
        id: `EV_${randomUUID()}`,
        createdAt: String(Math.floor(Date.now() / 1000)),
        room: { sid: 'RM_test', name: `voice:${channelId}` },
        participant: {
            sid,
            identity: users[who].id,
            joinedAt: String(Math.floor(joinedAt.getTime() / 1000)),
            joinedAtMs: String(joinedAt.getTime())
        }
    })
    const joins = (who: Who, channelId: string, sid: string, joinedAt = new Date()) =>
        webhook(participantEvent('participant_joined', who, channelId, sid, joinedAt))
    const leaves = (who: Who, channelId: string, sid: string, joinedAt = new Date()) =>
        webhook(participantEvent('participant_left', who, channelId, sid, joinedAt))

    const rowOf = (who: Who) =>
        prisma.voiceState.findUnique({
            where: { userId: users[who].id },
            select: { channelId: true, participantSid: true, micOn: true, cameraOn: true }
        })

    /** A room's people as `who` reads them in GET /servers/{id}; undefined when they cannot see it. */
    const peopleIn = async (who: Who, channelId: string) => {
        const res = await as(who, api().get(`/api/v1/servers/${serverId}`))
        const channel = res.body.data.channels.find((c: { id: string }) => c.id === channelId)
        return channel?.voice_states as { user: { id: string } }[] | undefined
    }

    const askToken = (who: Who, channelId: string) =>
        as(who, api().post('/api/v1/voice/token')).send({ channel_id: channelId })
    const claimsOf = (token: string) => new TokenVerifier(livekitTarget.apiKey, livekitTarget.apiSecret).verify(token)

    beforeAll(async () => {
        app = await bootApp()
        await app.listen(0)
        socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi', 'dung', 'em'] as Who[]) await signUp(who)

        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Nhóm học Giải tích', template: 'standard' })
        serverId = created.body.data.id
        const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        for (const who of ['binh', 'chi', 'dung', 'em'] as Who[]) {
            await as(who, api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
        }
        const room = async (name: string, isPrivate = false) => {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'voice', name, is_private: isPrivate, view_role_ids: [] })
            expect(res.status).toBe(201)
            return res.body.data.id as string
        }
        roomId = await room('Phòng ôn thi')
        otherRoomId = await room('Phòng làm bài')
        // Only its roles see it, and it has none: the owner alone.
        privateRoomId = await room('Phòng ban cán sự', true)

        // Dũng is timed out for a day.
        await as('an', api().patch(`/api/v1/servers/${serverId}/members/${users.dung.id}`)).send({
            timeout_seconds: 86_400,
            reason: 'Thử'
        })
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

    const emptyRooms = () =>
        prisma.voiceState.deleteMany({ where: { channelId: { in: [roomId, otherRoomId, privateRoomId] } } })

    describe('constraints of the database (20261118100000_voice)', () => {
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
        /** Someone in a room, written straight to the table. */
        const inRoom = (who: Who, channelId: string, shape: { screenSharing?: boolean } = {}) =>
            prisma.voiceState.create({
                data: {
                    userId: users[who].id,
                    channelId,
                    participantSid: `PA_${randomUUID()}`,
                    joinedAt: new Date(),
                    ...shape
                },
                select: { userId: true }
            })

        afterEach(emptyRooms)

        it('keeps one row per person: an account is in one room at a time (D-210)', async () => {
            expect(await refusedBy(inRoom('an', roomId))).toBe('written')
            expect(await refusedBy(inRoom('an', otherRoomId))).toBe('VoiceState_pkey')
        })

        it('lets one person per room share a screen (D-101)', async () => {
            expect(await refusedBy(inRoom('an', roomId, { screenSharing: true }))).toBe('written')
            expect(await refusedBy(inRoom('binh', roomId))).toBe('written')
            expect(await refusedBy(inRoom('chi', roomId, { screenSharing: true }))).toBe(
                'VoiceState_one_screen_share_per_room'
            )
            // Another room has its own screen.
            expect(await refusedBy(inRoom('chi', otherRoomId, { screenSharing: true }))).toBe('written')
        })

        it('empties a room whose channel is deleted', async () => {
            await inRoom('an', otherRoomId)
            await prisma.channel.delete({ where: { id: otherRoomId } })
            expect(await prisma.voiceState.count({ where: { userId: users.an.id } })).toBe(0)
            otherRoomId = (
                await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                    .set('Idempotency-Key', randomUUID())
                    .send({ type: 'voice', name: 'Phòng làm bài', is_private: false, view_role_ids: [] })
            ).body.data.id
        })
    })

    // What the tokens grant is in the adapter's unit spec; here, that LiveKit
    // takes them, and its answers about rooms.
    describe('the media server (MEDIA_ROOMS against the LiveKit of test:services:up, D-204)', () => {
        const mediaRooms = () => app.get<MediaRoomsPort>(MEDIA_ROOMS)
        /** LiveKit's own check of a join token: what a browser joining with it would meet first. */
        const livekitTakes = async (token: string) => {
            const http = livekitTarget.url.replace(/^ws/, 'http')
            return (await fetch(`${http}/rtc/validate?access_token=${encodeURIComponent(token)}`)).status
        }
        const room = `voice:${randomUUID()}`

        it('signs join tokens LiveKit takes, also to listen only, and says where to connect', async () => {
            for (const sources of [['microphone', 'camera', 'screen_share', 'screen_share_audio'], []] as const) {
                const { token, url } = await mediaRooms().issueJoinToken({
                    room,
                    identity: users.an.id,
                    name: 'An',
                    sources: [...sources]
                })
                expect(url).toBe(livekitTarget.url)
                expect(await livekitTakes(token)).toBe(200)
            }
        })

        it('signs with the configured secret: a token signed with another one is refused', async () => {
            const settings = {
                ...app.get(ConfigService).getOrThrow('livekit'),
                apiSecret: 'not-the-secret-of-this-livekit'
            }
            const other = new LiveKitMediaRooms(new ConfigService({ livekit: settings }))
            const { token } = await other.issueJoinToken({ room, identity: users.an.id, name: 'An', sources: [] })
            expect(await livekitTakes(token)).toBe(401)
        })

        it('finds nobody in a room LiveKit has never heard of, and putting out someone not there changes nothing', async () => {
            expect(await mediaRooms().listParticipants(room)).toEqual([])
            await expect(mediaRooms().removeParticipant(room, users.an.id)).resolves.toBe(false)
        })

        it('lists its rooms', async () => {
            await expect(mediaRooms().listRooms()).resolves.toEqual(expect.any(Array))
        })
    })

    describe('a token to join (POST /voice/token, REQ-VC-01, D-210)', () => {
        afterEach(emptyRooms)

        it('is for the room, the person, and what SPEAK and VIDEO allow; LiveKit takes it', async () => {
            const res = await askToken('binh', roomId)

            expect(res.status).toBe(201)
            expect(res.body.data.url).toBe(livekitTarget.url)
            expect(await claimsOf(res.body.data.token)).toMatchObject({
                sub: users.binh.id,
                video: {
                    room: `voice:${roomId}`,
                    roomJoin: true,
                    canPublish: true,
                    canPublishData: false,
                    canPublishSources: ['microphone', 'camera', 'screen_share', 'screen_share_audio']
                }
            })
            const http = livekitTarget.url.replace(/^ws/, 'http')
            const token = encodeURIComponent(res.body.data.token)
            expect((await fetch(`${http}/rtc/validate?access_token=${token}`)).status).toBe(200)
        })

        it('follows @everyone: listening only without SPEAK and VIDEO, FORBIDDEN without CONNECT', async () => {
            const roles = await as('an', api().get(`/api/v1/servers/${serverId}/roles`))
            const everyone = roles.body.data.roles.find((r: { is_everyone: boolean }) => r.is_everyone).id
            const allow = (bits: bigint) =>
                as('an', api().patch(`/api/v1/servers/${serverId}/roles/${everyone}`)).send({
                    permissions: bits.toString()
                })
            try {
                const listening = EVERYONE_DEFAULT_PERMISSIONS & ~Permission.SPEAK & ~Permission.VIDEO
                expect((await allow(listening)).status).toBe(200)
                const listener = await askToken('binh', roomId)
                expect((await claimsOf(listener.body.data.token)).video).toMatchObject({
                    canPublish: false,
                    canSubscribe: true
                })

                expect((await allow(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT)).status).toBe(200)
                expect(outcome(await askToken('binh', roomId))).toEqual([403, 'FORBIDDEN_ERROR'])
                // The owner keeps every permission.
                expect((await askToken('an', roomId)).status).toBe(201)
            } finally {
                await allow(EVERYONE_DEFAULT_PERMISSIONS)
            }
        })

        it('is MEMBER_TIMED_OUT, saying until when, for a member timed out', async () => {
            const res = await askToken('dung', roomId)
            expect(outcome(res)).toEqual([403, 'MEMBER_TIMED_OUT'])
            expect(res.body.data.timeout_until).toEqual(expect.any(String))
        })

        it('is NOT_FOUND for a room one may not view, a text channel, and no channel (NFR-SEC-05)', async () => {
            const servers = await as('an', api().get(`/api/v1/servers/${serverId}`))
            const text = servers.body.data.channels.find((c: { type: string }) => c.type === 'text').id
            for (const channelId of [privateRoomId, text, randomUUID()]) {
                expect(outcome(await askToken('binh', channelId))).toEqual([404, 'NOT_FOUND_ERROR'])
            }
        })

        it('puts someone in another room out of it first, and tells that room (one connection per account)', async () => {
            expect((await joins('binh', otherRoomId, 'PA_b1')).status).toBe(200)
            // Its own voice_state.updated goes out after the answer: let it pass first.
            await new Promise((resolve) => setTimeout(resolve, 300))
            const heard = collect(await connectAs('chi'), 'voice_state.updated')

            expect((await askToken('binh', roomId)).status).toBe(201)

            expect(await rowOf('binh')).toBeNull()
            expect(await heard()).toEqual([{ channel_id: otherRoomId, voice_states: [] }])
        })
    })

    describe("LiveKit's webhooks (POST /voice/livekit-webhook, D-210)", () => {
        afterEach(emptyRooms)

        it('refuses one unsigned, signed with another secret, or whose body was changed', async () => {
            const body = JSON.stringify(participantEvent('participant_joined', 'binh', roomId, 'PA_x', new Date()))

            expect(outcome(await sendHook(body))).toEqual([401, 'AUTH_UNAUTHORIZED'])
            const otherSecret = await signatureOf(body, 'not-the-secret-of-this-livekit')
            expect(outcome(await sendHook(body, otherSecret))).toEqual([401, 'AUTH_UNAUTHORIZED'])
            const changed = body.replace('PA_x', 'PA_y')
            expect(outcome(await sendHook(changed, await signatureOf(body)))).toEqual([401, 'AUTH_UNAUTHORIZED'])
            expect(await rowOf('binh')).toBeNull()
        })

        it("puts who joined on the room's list, in GET /servers and live, once however often it is sent", async () => {
            const heard = collect(await connectAs('chi'), 'voice_state.updated')
            const joinedAt = new Date()
            const joined = participantEvent('participant_joined', 'binh', roomId, 'PA_b1', joinedAt)

            expect((await webhook(joined)).status).toBe(200)
            expect((await webhook(joined)).status).toBe(200)

            const person = {
                user: {
                    id: users.binh.id,
                    username: expect.any(String),
                    display_name: expect.any(String),
                    avatar_url: null
                },
                role_ids: [],
                is_owner: false,
                joined_at: joinedAt.toISOString(),
                mic_on: false,
                camera_on: false,
                screen_sharing: false,
                mod_muted: false
            }
            expect(await peopleIn('chi', roomId)).toEqual([person])
            expect(await peopleIn('chi', otherRoomId)).toEqual([])
            expect(await heard()).toEqual([{ channel_id: roomId, voice_states: [person] }])
        })

        it('takes an event once by its id: a join sent again after the leave does not bring the person back', async () => {
            const joinedAt = new Date()
            const joined = participantEvent('participant_joined', 'binh', roomId, 'PA_b1', joinedAt)
            await webhook(joined)
            await leaves('binh', roomId, 'PA_b1', joinedAt)

            expect((await webhook(joined)).status).toBe(200)

            expect(await rowOf('binh')).toBeNull()
        })

        it('shows the people of a private room to its viewers only (D-205)', async () => {
            expect((await joins('an', privateRoomId, 'PA_a1')).status).toBe(200)
            const heard = collect(await connectAs('binh'), 'voice_state.updated')

            expect(await peopleIn('binh', privateRoomId)).toBeUndefined()
            await leaves('an', privateRoomId, 'PA_a1')
            expect(await heard()).toEqual([])
            expect(await rowOf('an')).toBeNull()
        })

        it('ignores out of order: the late join of an older connection, and the leave of the one a reload replaced', async () => {
            const first = new Date(Date.now() - 10_000)
            const reload = new Date()
            await joins('binh', roomId, 'PA_new', reload)

            await joins('binh', roomId, 'PA_old', first)
            await leaves('binh', roomId, 'PA_old', first)
            expect(await rowOf('binh')).toMatchObject({ channelId: roomId, participantSid: 'PA_new' })

            await leaves('binh', roomId, 'PA_new', reload)
            expect(await rowOf('binh')).toBeNull()
        })

        it("decides each change of a person's row under their lock: one waits while another holds it", async () => {
            // Without it, a reload's join and its old connection's leave could
            // both read the old row; the join writes the new one, the leave
            // then deletes it. Too rare to hit by sending both at once, so the
            // test holds the lock itself (the key of voice-locks.ts).
            const states = app.get<VoiceStateRepositoryPort>(VOICE_STATE_REPOSITORY)
            const userId = users.binh.id
            const joined = { userId, channelId: roomId, participantSid: 'PA_locked', joinedAt: new Date() }
            let release = () => undefined as void
            let taken = () => undefined as void
            const lockTaken = new Promise<void>((resolve) => (taken = resolve))
            const holder = prisma.$transaction(
                async (tx) => {
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`voice-state:${userId}`}, 0))`
                    taken()
                    await new Promise<void>((resolve) => (release = resolve))
                },
                { timeout: 10_000 }
            )
            await lockTaken

            let written = false
            const change = states.change(userId, (current) => joinWrite(current, joined)).then(() => (written = true))
            await new Promise((resolve) => setTimeout(resolve, 300))
            expect(written).toBe(false)

            release()
            await holder
            await change
            expect(await rowOf('binh')).toMatchObject({ participantSid: 'PA_locked' })
        })

        it("reads and tells a room's list under the room's lock: lists read later are never told before one read earlier", async () => {
            // Without it, two changes close together could both read the
            // room, and the older list be told last. Too rare to hit by
            // sending both at once, so the test holds the lock itself (the
            // key of voice-locks.ts).
            const heard = collect(await connectAs('chi'), 'voice_state.updated')
            let release = () => undefined as void
            let taken = () => undefined as void
            const lockTaken = new Promise<void>((resolve) => (taken = resolve))
            const holder = prisma.$transaction(
                async (tx) => {
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`voice-room:${roomId}`}, 0))`
                    taken()
                    await new Promise<void>((resolve) => (release = resolve))
                },
                { timeout: 10_000 }
            )
            await lockTaken

            expect((await joins('binh', roomId, 'PA_room_locked')).status).toBe(200)
            expect(await rowOf('binh')).toMatchObject({ participantSid: 'PA_room_locked' })
            expect(await heard()).toEqual([])

            release()
            await holder
            const lists = (await heard()) as { voice_states: { user: { id: string } }[] }[]
            expect(lists.map((list) => list.voice_states.map((person) => person.user.id))).toEqual([[users.binh.id]])
        })

        it('keeps the new connection when its join and the old one leaving are written at once (a reload)', async () => {
            const states = app.get<VoiceStateRepositoryPort>(VOICE_STATE_REPOSITORY)
            const userId = users.binh.id
            const old = { userId, channelId: roomId, participantSid: 'PA_old', joinedAt: new Date(Date.now() - 10_000) }
            const fresh = { ...old, participantSid: 'PA_new', joinedAt: new Date() }
            await states.change(userId, (current) => joinWrite(current, old))

            await Promise.all([
                states.change(userId, (current) => joinWrite(current, fresh)),
                states.change(userId, (current) => leaveWrite(current, old.participantSid))
            ])

            expect(await rowOf('binh')).toMatchObject({ participantSid: 'PA_new' })
        })

        it('moves someone who joined another room: off the first list, onto the second', async () => {
            await joins('binh', roomId, 'PA_1', new Date(Date.now() - 5_000))
            await joins('binh', otherRoomId, 'PA_2')

            expect(await peopleIn('chi', roomId)).toEqual([])
            expect((await peopleIn('chi', otherRoomId))?.map((person) => person.user.id)).toEqual([users.binh.id])
        })

        it('answers and leaves alone an event of another kind, or of a room that is no voice room', async () => {
            const started = { event: 'room_started', id: `EV_${randomUUID()}`, room: { name: `voice:${roomId}` } }
            expect((await webhook(started)).status).toBe(200)
            const call = participantEvent('participant_joined', 'binh', roomId, 'PA_c', new Date())
            expect((await webhook({ ...call, room: { name: `call:${roomId}` } })).status).toBe(200)
            expect(await rowOf('binh')).toBeNull()
        })
    })

    describe('leaving, the reconciliation and the icons (D-206, D-210)', () => {
        afterEach(emptyRooms)

        it('takes someone who leaves off the list at once (POST /voice/leave), and answers the same in no room', async () => {
            await joins('binh', roomId, 'PA_1')

            expect((await as('binh', api().post('/api/v1/voice/leave'))).status).toBe(200)
            expect(await rowOf('binh')).toBeNull()
            expect((await as('binh', api().post('/api/v1/voice/leave'))).status).toBe(200)
        })

        it('removes a row LiveKit has no connection for once past its grace, and keeps a recent one', async () => {
            await joins('binh', roomId, 'PA_lost', new Date(Date.now() - 5 * 60_000))
            await joins('chi', roomId, 'PA_recent')

            await app.get(CommandBus).execute(new ReconcileVoiceRoomsCommand(new Date()))

            expect(await rowOf('binh')).toBeNull()
            expect(await rowOf('chi')).not.toBeNull()
        })

        it("writes a tab's microphone and camera and tells the room, only for someone in one", async () => {
            const binh = await connectAs('binh')
            const chi = await connectAs('chi')
            binh.emit('voice.self_state', { mic: true, camera: false })
            await new Promise((resolve) => setTimeout(resolve, 300))
            expect(await rowOf('binh')).toBeNull()

            await joins('binh', roomId, 'PA_1')
            const heard = collect(chi, 'voice_state.updated')
            binh.emit('voice.self_state', { mic: true, camera: true })

            // The join's own event may come first: its list is read after the answer to the webhook.
            const events = (await heard()) as { voice_states: { mic_on: boolean; camera_on: boolean }[] }[]
            expect(events.at(-1)?.voice_states).toEqual([expect.objectContaining({ mic_on: true, camera_on: true })])
            expect(await rowOf('binh')).toMatchObject({ micOn: true, cameraOn: true })
        })
    })

    describe('moderators, and the server putting people out (REQ-VC-04, D-207, D-212)', () => {
        // Chi holds a role with MUTE_MEMBERS and MOVE_MEMBERS, above Bình and Em, below An (the owner).
        let everyoneId: string
        const participant = (channelId: string, who: Who) =>
            `/api/v1/voice/rooms/${channelId}/participants/${users[who].id}`
        const mute = (by: Who, who: Who, channelId = roomId) =>
            as(by, api().post(`${participant(channelId, who)}/mute`))
        const unmute = (by: Who, who: Who) => as(by, api().delete(`${participant(roomId, who)}/mute`))
        const disconnect = (by: Who, who: Who) => as(by, api().delete(participant(roomId, who)))
        const mutedOf = async (who: Who) =>
            (await prisma.voiceState.findUnique({ where: { userId: users[who].id }, select: { modMuted: true } }))
                ?.modMuted
        const setEveryone = (bits: bigint) =>
            as('an', api().patch(`/api/v1/servers/${serverId}/roles/${everyoneId}`)).send({
                permissions: bits.toString()
            })
        /** Waits for the event handlers that run after a request has been answered. */
        const settled = () => new Promise((resolve) => setTimeout(resolve, 400))

        beforeAll(async () => {
            const roles = await as('an', api().get(`/api/v1/servers/${serverId}/roles`))
            everyoneId = roles.body.data.roles.find((r: { is_everyone: boolean }) => r.is_everyone).id
            const made = await as('an', api().post(`/api/v1/servers/${serverId}/roles`))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Quản lý phòng' })
            const roleId = made.body.data.role_id as string
            const allowed = await as('an', api().patch(`/api/v1/servers/${serverId}/roles/${roleId}`)).send({
                permissions: (Permission.MUTE_MEMBERS | Permission.MOVE_MEMBERS).toString()
            })
            const granted = await as('an', api().put(`/api/v1/servers/${serverId}/roles/${roleId}/members`)).send({
                user_ids: [users.chi.id]
            })
            expect([made.status, allowed.status, granted.status]).toEqual([201, 200, 200])
        })
        afterEach(emptyRooms)

        it('mutes and unmutes someone ranked lower: their row, the list with their roles, and their own tabs', async () => {
            await joins('binh', roomId, 'PA_binh')
            await joins('an', roomId, 'PA_an')
            const heard = collect(await connectAs('binh'), 'voice.muted')

            expect((await mute('chi', 'binh')).status).toBe(200)
            expect(await mutedOf('binh')).toBe(true)
            expect(await peopleIn('chi', roomId)).toEqual([
                expect.objectContaining({
                    user: expect.objectContaining({ id: users.binh.id }),
                    mod_muted: true,
                    role_ids: [],
                    is_owner: false
                }),
                expect.objectContaining({ user: expect.objectContaining({ id: users.an.id }), is_owner: true })
            ])
            // Muted already: answered the same, nothing told again (D-212).
            expect((await mute('chi', 'binh')).status).toBe(200)

            expect((await unmute('chi', 'binh')).status).toBe(200)
            expect(await mutedOf('binh')).toBe(false)
            expect(await heard()).toEqual([
                { channel_id: roomId, muted: true },
                { channel_id: roomId, muted: false }
            ])
        })

        it('refuses without the permission, on someone level or above, and for someone not in the room', async () => {
            await joins('an', roomId, 'PA_an')
            await joins('chi', roomId, 'PA_chi')

            expect(outcome(await mute('binh', 'chi'))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect(outcome(await mute('chi', 'an'))).toEqual([403, 'ROLE_HIERARCHY_VIOLATION'])
            expect(outcome(await mute('chi', 'chi'))).toEqual([403, 'ROLE_HIERARCHY_VIOLATION'])
            expect(outcome(await disconnect('chi', 'an'))).toEqual([403, 'ROLE_HIERARCHY_VIOLATION'])
            expect(outcome(await mute('chi', 'binh'))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await mute('chi', 'binh', privateRoomId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await mute('dung', 'binh'))).toEqual([403, 'MEMBER_TIMED_OUT'])
            expect(await mutedOf('an')).toBe(false)
        })

        it('puts someone out, telling them it was a moderator, never who', async () => {
            await joins('binh', roomId, 'PA_binh')
            const heard = collect(await connectAs('binh'), 'voice.disconnected')

            expect((await disconnect('chi', 'binh')).status).toBe(200)

            expect(await rowOf('binh')).toBeNull()
            expect(await heard()).toEqual([{ channel_id: roomId, reason: 'moderator' }])
        })

        it('puts out one who lost CONNECT, told permission; one who lost SPEAK stays', async () => {
            await joins('binh', roomId, 'PA_binh')
            const heard = collect(await connectAs('binh'), 'voice.disconnected')
            try {
                expect((await setEveryone(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.SPEAK)).status).toBe(200)
                await settled()
                expect(await rowOf('binh')).not.toBeNull()

                expect((await setEveryone(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT)).status).toBe(200)
                expect(await heard()).toEqual([{ channel_id: roomId, reason: 'permission' }])
                expect(await rowOf('binh')).toBeNull()
            } finally {
                await setEveryone(EVERYONE_DEFAULT_PERMISSIONS)
            }
        })

        it('puts out one timed out, then one kicked, each told why', async () => {
            const heard = collect(await connectAs('em'), 'voice.disconnected')
            await joins('em', roomId, 'PA_em_1')
            await as('an', api().patch(`/api/v1/servers/${serverId}/members/${users.em.id}`)).send({
                timeout_seconds: 60,
                reason: 'Thử'
            })
            await settled()
            expect(await rowOf('em')).toBeNull()

            // Timed out, a join (a token taken before) is put out, never listed (D-212).
            await joins('em', roomId, 'PA_em_2')
            expect(await rowOf('em')).toBeNull()

            await as('an', api().patch(`/api/v1/servers/${serverId}/members/${users.em.id}`)).send({
                timeout_seconds: null
            })
            await joins('em', roomId, 'PA_em_3')
            expect(await rowOf('em')).not.toBeNull()
            const kicked = await as('an', api().delete(`/api/v1/servers/${serverId}/members/${users.em.id}`)).send({})
            expect(kicked.status).toBe(200)
            expect(await heard()).toEqual([
                { channel_id: roomId, reason: 'timeout' },
                { channel_id: roomId, reason: 'kick' }
            ])
            expect(await rowOf('em')).toBeNull()
        })
    })
})
