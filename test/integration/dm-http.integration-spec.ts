import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Direct messages through the whole app (REQ-SOCIAL-04, SRS 5.1, D-238,
 * D-242, D-244): opening, closing and listing them; their messages on the
 * channel routes; the one answer for every reason someone cannot be
 * written to; their unread in the read states; an account deleted in one.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then
 * `pnpm test:integration`.
 */
describe('Direct messages (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-dm-${randomUUID().slice(0, 8)}`
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

    const open = (who: Who, other: Who | string) =>
        as(who, api().post('/api/v1/me/dms'))
            .set('Idempotency-Key', randomUUID())
            .send({ user_id: other in users ? users[other as Who].id : other })
    const close = (who: Who, dmId: string) => as(who, api().delete(`/api/v1/me/dms/${dmId}`))
    const listed = async (who: Who): Promise<{ id: string; [key: string]: unknown }[]> =>
        (await as(who, api().get('/api/v1/me/dms'))).body.data.dms
    const send = (who: Who, channelId: string, content: string) =>
        as(who, api().post(`/api/v1/channels/${channelId}/messages`))
            .set('Idempotency-Key', randomUUID())
            .send({ content, nonce: randomUUID() })
    const readStates = async (who: Who): Promise<Record<string, unknown>[]> =>
        (await as(who, api().get('/api/v1/me/read-states'))).body.data.items
    /**
     * What a refusal says: status, type, code and words, which must not tell
     * one reason from another; the words name the one asked for, so that id
     * is set aside.
     */
    const refusal = (res: request.Response) => [
        res.status,
        res.body.meta.type,
        res.body.meta.code,
        String(res.body.meta.message).replace(/[0-9a-f-]{36}/, '<user>')
    ]

    /** A server An owns with the others given as members. */
    async function share(...members: Who[]) {
        const server = await prisma.server.create({ data: { name: 'Ôn thi Giải tích 2', ownerId: users.an.id } })
        await prisma.member.createMany({
            data: ['an' as Who, ...members].map((who) => ({ serverId: server.id, userId: users[who].id }))
        })
    }
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
    const block = (blocker: Who, blocked: Who) =>
        prisma.block.create({ data: { blockerId: users[blocker].id, blockedId: users[blocked].id } })

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
        await prisma.userSettings.updateMany({
            where: { userId: { in: ids } },
            data: { allowServerMemberMessages: true }
        })
        await prisma.relationship.deleteMany({ where: { userLowId: { in: ids } } })
        await prisma.block.deleteMany({ where: { blockerId: { in: ids } } })
        // A conversation's channel takes its DmChannel and messages with it.
        await prisma.channel.deleteMany({
            where: { dm: { OR: [{ userLowId: { in: ids } }, { userHighId: { in: ids } }] } }
        })
        await prisma.server.deleteMany({ where: { ownerId: { in: ids } } })
    })

    describe('opening and listing (POST, GET /me/dms)', () => {
        it('opens one with someone in a shared server; the other sees it with its first message, unread', async () => {
            await share('binh')

            const opened = await open('an', 'binh')

            expect(opened.status).toBe(200)
            const dm = opened.body.data
            expect(dm).toMatchObject({
                user: { id: users.binh.id, username: expect.any(String) },
                presence: expect.any(String),
                can_message: true,
                last_message: null
            })
            expect((await listed('an')).map((one) => one.id)).toEqual([dm.id])
            expect(await listed('binh')).toEqual([])

            const sent = await send('an', dm.id, 'Bình ơi, câu 3 làm sao?')
            expect(sent.status).toBe(201)

            const theirs = await listed('binh')
            expect(theirs).toEqual([
                expect.objectContaining({
                    id: dm.id,
                    user: expect.objectContaining({ id: users.an.id }),
                    last_message: expect.objectContaining({
                        author_id: users.an.id,
                        content: 'Bình ơi, câu 3 làm sao?'
                    })
                })
            ])
            expect(await readStates('binh')).toContainEqual(
                expect.objectContaining({ server_id: null, channel_id: dm.id, unread_count: 1 })
            )
        })

        it('answers the same DM from either side, one row however many times it is opened', async () => {
            await share('binh')
            const first = (await open('an', 'binh')).body.data.id

            const [again, theirs] = await Promise.all([open('an', 'binh'), open('binh', 'an')])

            expect([again.body.data.id, theirs.body.data.id]).toEqual([first, first])
            expect(await prisma.dmChannel.count({ where: { channelId: first } })).toBe(1)
        })

        it('makes one DM when the two open it at the same time (the pair’s lock)', async () => {
            await befriend('an', 'dung')

            const [a, b] = await Promise.all([open('an', 'dung'), open('dung', 'an')])

            expect(a.body.data.id).toBe(b.body.data.id)
            const [low, high] = [users.an.id, users.dung.id].sort()
            expect(await prisma.dmChannel.count({ where: { userLowId: low, userHighId: high } })).toBe(1)
        })

        it('answers not found for oneself, no such account, and an account waiting to be deleted', async () => {
            await befriend('an', 'chi')
            await prisma.user.update({ where: { id: users.chi.id }, data: { deletionRequestedAt: new Date() } })

            for (const other of ['an', randomUUID(), 'chi']) {
                const res = await open('an', other)
                expect([other, res.status, res.body.meta.type]).toEqual([other, 404, 'NOT_FOUND_ERROR'])
            }
        })
    })

    describe('the one answer for every reason (REQ-SOCIAL-04, REQ-SOCIAL-03)', () => {
        it('says the same, word for word, whatever the reason, when opening one', async () => {
            await share('binh')
            await prisma.userSettings.update({
                where: { userId: users.binh.id },
                data: { allowServerMemberMessages: false }
            })
            const settingOff = await open('an', 'binh')
            // A stranger: no friendship, no server shared.
            const stranger = await open('an', 'chi')
            await befriend('an', 'dung')
            await block('dung', 'an')
            const blocked = await open('an', 'dung')

            expect(refusal(settingOff)).toEqual([403, 'CANNOT_MESSAGE_USER', '403920', expect.any(String)])
            expect(refusal(stranger)).toEqual(refusal(settingOff))
            expect(refusal(blocked)).toEqual(refusal(settingOff))
        })

        it('refuses writing in a DM there is, the same way, while its history stays readable and one’s own deletable', async () => {
            await share('binh')
            const dm = (await open('an', 'binh')).body.data.id
            const mine = (await send('an', dm, 'Tin của An')).body.data
            const theirs = (await send('binh', dm, 'Tin của Bình')).body.data
            await block('binh', 'an')

            const refused = await send('an', dm, 'Còn đó không?')
            const reacted = await as(
                'an',
                api().put(`/api/v1/messages/${theirs.id}/reactions/${encodeURIComponent('👍')}`)
            )
            const pinned = await as('an', api().put(`/api/v1/channels/${dm}/pins/${theirs.id}`))
            await prisma.block.deleteMany({ where: { blockerId: users.binh.id } })
            await prisma.userSettings.update({
                where: { userId: users.binh.id },
                data: { allowServerMemberMessages: false }
            })
            const settingOff = await send('an', dm, 'Còn đó không?')

            expect(refusal(refused)).toEqual([403, 'CANNOT_MESSAGE_USER', '403920', expect.any(String)])
            for (const other of [reacted, pinned, settingOff]) expect(refusal(other)).toEqual(refusal(refused))
            const history = await as('an', api().get(`/api/v1/channels/${dm}/messages`))
            expect(history.body.data.items.map((item: { id: string }) => item.id)).toEqual([mine.id, theirs.id])
            expect((await as('an', api().delete(`/api/v1/messages/${mine.id}`))).status).toBe(200)
            expect((await as('an', api().delete(`/api/v1/messages/${theirs.id}`))).status).toBe(403)
            // It still lists, saying so.
            expect(await listed('an')).toEqual([expect.objectContaining({ id: dm, can_message: false })])
        })
    })

    describe('a DM is theirs alone (NFR-SEC-05)', () => {
        it('answers not found to anyone else, on every route', async () => {
            await share('binh')
            const dm = (await open('an', 'binh')).body.data.id
            const message = (await send('an', dm, 'Chỉ hai đứa mình')).body.data

            expect((await as('chi', api().get(`/api/v1/channels/${dm}/messages`))).status).toBe(404)
            expect((await send('chi', dm, 'Chen vào')).status).toBe(404)
            expect((await as('chi', api().post(`/api/v1/channels/${dm}/ack`)).send({})).status).toBe(404)
            expect((await as('chi', api().delete(`/api/v1/messages/${message.id}`))).status).toBe(404)
            expect((await close('chi', dm)).status).toBe(404)
        })
    })

    describe('closing (DELETE /me/dms/{id}, D-244)', () => {
        it('takes it out of my list and my unread until a message comes after, then opening clears the mark', async () => {
            await share('binh')
            const dm = (await open('an', 'binh')).body.data.id
            await send('binh', dm, 'Tin trước khi đóng')

            expect((await close('an', dm)).status).toBe(200)
            expect((await close('an', dm)).status).toBe(200)
            expect(await listed('an')).toEqual([])
            expect((await readStates('an')).map((state) => state.channel_id)).not.toContain(dm)

            await send('binh', dm, 'Tin sau khi đóng')
            expect((await listed('an')).map((one) => one.id)).toEqual([dm])
            // Shown again with the unread from before it was closed (D-244).
            expect(await readStates('an')).toContainEqual(expect.objectContaining({ channel_id: dm, unread_count: 2 }))

            await open('an', 'binh')
            const [low] = [users.an.id, users.binh.id].sort()
            const row = await prisma.dmChannel.findUniqueOrThrow({ where: { channelId: dm } })
            expect(low === users.an.id ? row.lowClosedAt : row.highClosedAt).toBeNull()
        })
    })

    describe('mentions in a DM (D-238)', () => {
        it('counts a mention of the other one in their unread, and puts nothing in any inbox', async () => {
            await share('binh', 'chi')
            const dm = (await open('an', 'binh')).body.data.id

            await send('an', dm, `<@${users.binh.id}> <@${users.chi.id}> @everyone xem câu 3`)

            expect(await readStates('binh')).toContainEqual(
                expect.objectContaining({ channel_id: dm, unread_count: 1, mention_count: 1 })
            )
            const ids = [users.binh.id, users.chi.id]
            expect(await prisma.notification.count({ where: { userId: { in: ids } } })).toBe(0)
        })
    })

    describe('an account deleted in a DM (D-182, spec 09 `deleted-account`)', () => {
        it('keeps the DM and its history, the other one shown as deleted, not to be written to', async () => {
            await befriend('an', 'dung')
            const dm = (await open('an', 'dung')).body.data.id
            await send('dung', dm, 'Ok, mai gửi bạn file')
            await prisma.user.update({ where: { id: users.dung.id }, data: { deletionRequestedAt: new Date() } })

            expect(await listed('an')).toEqual([
                expect.objectContaining({
                    id: dm,
                    user: { id: users.dung.id, username: null, display_name: null, avatar_url: null },
                    presence: null,
                    can_message: false,
                    last_message: expect.objectContaining({ content: 'Ok, mai gửi bạn file' })
                })
            ])
            expect(refusal(await send('an', dm, 'Còn đó không?'))[2]).toBe('403920')
            const history = await as('an', api().get(`/api/v1/channels/${dm}/messages`))
            expect(history.body.data.items[0].author).toMatchObject({ id: users.dung.id, username: null })
            expect((await open('an', 'dung')).body.data.id).toBe(dm)
        })
    })
})
