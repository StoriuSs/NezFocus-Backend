import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

const HIDDEN = { username: null, display_name: null, avatar_url: null }

/**
 * An account waiting 14 days to be deleted is still live (D-141), but others
 * see it as deleted: no name, no username, no picture, wherever they meet it
 * (REQ-AUTH-09, D-182). Restoring it brings them back. Only the whole app
 * shows this: each list reads people through its own query.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('An account waiting to be deleted, as others see it (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-pending-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi' | 'dung'

    let app: NestExpressApplication
    let prisma: PrismaService
    const users = {} as Record<Who, { token: string; id: string; username: string }>
    let serverId: string
    let generalId: string
    let welcomeId: string
    let inviteOfBinh: string
    let saidByBinh: string
    let answerOfChi: string

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
            .send({ content, nonce: randomUUID(), ...(replyToId ? { reply_to_id: replyToId } : {}) })
    const read = async (who: Who, path: string) => {
        const res = await as(who, api().get(`/api/v1/${path}`))
        expect(res.status).toBe(200)
        return res.body.data
    }
    type Person = { id?: string; user_id?: string }
    const history = async (channelId: string) =>
        (await read('chi', `channels/${channelId}/messages`)).items as (Record<string, unknown> & { id: string })[]
    const members = async (query = '') =>
        (await read('chi', `servers/${serverId}/members?sort=name&order=asc${query}`)).items as (Person &
            Record<string, unknown>)[]
    const waitToBeDeleted = (who: Who, at: Date | null) =>
        prisma.user.update({ where: { id: users[who].id }, data: { deletionRequestedAt: at } })

    async function signUp(who: Who) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        const username = await completeAccount(post, accessToken, PASSWORD)
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id, username }
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi', 'dung'] as Who[]) await signUp(who)
        // A name of their own and a picture, both of which must not show.
        await prisma.user.update({
            where: { id: users.binh.id },
            data: { displayName: 'Bình Nguyễn', avatarUrl: `avatars/${users.binh.id}/face.webp` }
        })

        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Xác suất', template: 'standard' })
        serverId = created.body.data.id
        const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        for (const who of ['binh', 'chi', 'dung'] as Who[]) {
            await as(who, api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
        }
        const server = await prisma.server.findUniqueOrThrow({ where: { id: serverId } })
        // The standard template's one text channel, where joins are told too.
        welcomeId = server.welcomeChannelId!
        generalId = welcomeId

        const ofBinh = await as('binh', api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        inviteOfBinh = ofBinh.body.data.code
        expect([ofBinh.status, inviteOfBinh === invite.body.data.code]).toEqual([200, false])

        saidByBinh = (await send('binh', generalId, 'Chào cả lớp')).body.data.id
        answerOfChi = (await send('chi', generalId, `Chào <@${users.binh.id}>`, saidByBinh)).body.data.id
        const reacted = await as(
            'binh',
            api().put(`/api/v1/messages/${answerOfChi}/reactions/${encodeURIComponent('👍')}`)
        )
        expect(reacted.status).toBeLessThan(300)
        const pinned = await as('an', api().put(`/api/v1/channels/${generalId}/pins/${saidByBinh}`))
        expect(pinned.status).toBeLessThan(300)
        // Dũng is banned, then asks to delete their account.
        const banned = await as('an', api().put(`/api/v1/servers/${serverId}/bans/${users.dung.id}`)).send({
            reason: 'Spam'
        })
        expect(banned.status).toBeLessThan(300)

        await waitToBeDeleted('binh', new Date())
        await waitToBeDeleted('dung', new Date())
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.message.deleteMany({ where: { channel: { serverId } } }).catch(() => undefined)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    it('hides them in messages: as author, in the answer quoting them, as a mention, as a reactor, pinned', async () => {
        const items = await history(generalId)
        expect(items.find((message) => message.id === saidByBinh)!.author).toEqual({ id: users.binh.id, ...HIDDEN })
        const answer = items.find((message) => message.id === answerOfChi)!
        expect(answer.reply_to).toMatchObject({ author: { id: users.binh.id, ...HIDDEN } })
        expect(answer.mention_users).toEqual([{ id: users.binh.id, username: null, display_name: null }])

        const reactors = await read('chi', `messages/${answerOfChi}/reactions/${encodeURIComponent('👍')}`)
        expect(reactors.users).toEqual([{ id: users.binh.id, username: null, display_name: null }])

        const pins = (await read('chi', `channels/${generalId}/pins`)).items as { id: string; author: unknown }[]
        expect(pins.find((pin) => pin.id === saidByBinh)!.author).toEqual({ id: users.binh.id, ...HIDDEN })
    })

    it('hides them in the system message saying they joined', async () => {
        const joined = (await history(welcomeId)).find(
            (message) => (message.system_user as Person | null)?.id === users.binh.id
        )
        expect(joined!.system_user).toEqual({ id: users.binh.id, ...HIDDEN })
    })

    it('keeps them in the member list as a deleted account, last by name, found by no name', async () => {
        const listed = await members()
        expect(listed.at(-1)).toMatchObject({ user_id: users.binh.id, ...HIDDEN })
        expect(listed.map((member) => member.user_id)).toHaveLength(3)

        expect(await members(`&q=${encodeURIComponent('Bình')}`)).toEqual([])
        expect(await members(`&q=${users.binh.username}`)).toEqual([])
    })

    it('hides them in the ban list, and as the one who made an invite', async () => {
        const bans = (await read('an', `servers/${serverId}/bans`)).items as { user: Person }[]
        expect(bans.find((ban) => ban.user.user_id === users.dung.id)!.user).toEqual({
            user_id: users.dung.id,
            ...HIDDEN
        })

        const invites = (await read('an', `servers/${serverId}/invites`)).invites as {
            code: string
            creator: unknown
        }[]
        expect(invites.find((invite) => invite.code === inviteOfBinh)!.creator).toEqual({ state: 'deleted' })
        const preview = await anyone(api().get(`/api/v1/invites/${inviteOfBinh}`))
        expect(preview.body.data.inviter_name).toBeNull()
    })

    it('shows them again once they restore the account', async () => {
        await waitToBeDeleted('binh', null)
        try {
            const items = await history(generalId)
            expect(items.find((message) => message.id === saidByBinh)!.author).toMatchObject({
                username: users.binh.username,
                display_name: 'Bình Nguyễn',
                avatar_url: expect.any(String)
            })
            expect(await members(`&q=${encodeURIComponent('binh')}`)).toEqual([
                expect.objectContaining({ user_id: users.binh.id, display_name: 'Bình Nguyễn' })
            ])
            const preview = await anyone(api().get(`/api/v1/invites/${inviteOfBinh}`))
            expect(preview.body.data.inviter_name).toBe('Bình Nguyễn')
        } finally {
            await waitToBeDeleted('binh', new Date())
        }
    })
})
