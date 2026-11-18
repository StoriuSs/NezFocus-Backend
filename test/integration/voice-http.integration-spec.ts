import { randomUUID } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { MEDIA_ROOMS, MediaRoomsPort } from '@/modules/voice/application'
import { LiveKitMediaRooms } from '@/modules/voice/infrastructure'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { livekitTarget, testClientIp } from './targets'

/**
 * Voice rooms through the whole app (REQ-VC-01 to 05, SRS 5.1, D-204 to
 * D-210): who is in which room, kept in VoiceState, and the LiveKit behind
 * MEDIA_ROOMS.
 *
 * Requires Postgres, Redis, Mailpit and LiveKit: `pnpm test:services:up`,
 * then `pnpm test:integration`.
 */
describe('Voice rooms (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-voice-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi'

    let app: NestExpressApplication
    let prisma: PrismaService
    const users = {} as Record<Who, { token: string; id: string }>
    let serverId: string
    let roomId: string
    let otherRoomId: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }

    async function signUp(who: Who) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, PASSWORD)
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id }
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi'] as Who[]) await signUp(who)

        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Nhóm học Giải tích', template: 'standard' })
        serverId = created.body.data.id
        const room = async (name: string) => {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'voice', name, is_private: false, view_role_ids: [] })
            expect(res.status).toBe(201)
            return res.body.data.id as string
        }
        roomId = await room('Phòng ôn thi')
        otherRoomId = await room('Phòng làm bài')
    })

    afterAll(async () => {
        const all = Object.values(users).map((user) => user.id)
        await prisma?.server.deleteMany({ where: { ownerId: { in: all } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

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

        afterEach(() => prisma.voiceState.deleteMany({ where: { channelId: { in: [roomId, otherRoomId] } } }))

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
            await expect(mediaRooms().removeParticipant(room, users.an.id)).resolves.toBeUndefined()
        })
    })
})
