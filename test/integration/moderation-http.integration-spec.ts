import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { Permission } from '@/modules/permissions'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Kick, ban and timeout through the whole app (REQ-ROLE-04, D-147, D-154,
 * D-155): who is out of the server and who may come back; the ban list;
 * a timeout that leaves only viewing, seen by all and explained only to
 * moderators; a ban racing a join; and the member list's orders (D-89).
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Moderation over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-mod-${randomUUID().slice(0, 8)}`

    type Who = 'an' | 'binh' | 'chi' | 'dung' | 'phong'
    let app: NestExpressApplication
    let prisma: PrismaService
    const users: Record<Who, { token: string; id: string }> = {} as never

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]
    const url = (serverId: string, path = '') => `/api/v1/servers/${serverId}${path}`

    const kick = (who: Who, serverId: string, target: Who, reason?: string) =>
        as(who, api().delete(url(serverId, `/members/${users[target].id}`))).send(reason ? { reason } : {})
    const ban = (who: Who, serverId: string, target: Who, reason?: string) =>
        as(who, api().put(url(serverId, `/bans/${users[target].id}`))).send(reason ? { reason } : {})
    const unban = (who: Who, serverId: string, target: Who) =>
        as(who, api().delete(url(serverId, `/bans/${users[target].id}`)))
    const timeout = (who: Who, serverId: string, target: Who, seconds: number | null, reason?: string) =>
        as(who, api().patch(url(serverId, `/members/${users[target].id}`))).send({ timeout_seconds: seconds, reason })
    const join = (who: Who, code: string) => as(who, api().post(`/api/v1/invites/${code}/accept`))
    const newInvite = (who: Who, serverId: string) =>
        as(who, api().post(url(serverId, '/invites')))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
    const members = async (who: Who, serverId: string, query = '') =>
        (await as(who, api().get(url(serverId, `/members${query}`)))).body.data.items as {
            user_id: string
            timeout_until: string | null
            timeout_reason: string | null
        }[]
    const isMember = async (who: Who, serverId: string) =>
        (await prisma.member.count({ where: { serverId, userId: users[who].id } })) === 1

    async function signUp(who: Who, displayName: string) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, 'Harbour-Lantern-42')
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        await prisma.user.update({ where: { id: me.body.data.id }, data: { displayName } })
        users[who] = { token: accessToken, id: me.body.data.id }
    }

    /**
     * An's Study Server with Bình (Trưởng nhóm: kicks and times out, does not
     * ban), Chi and Dũng in it through a link; Phong stays outside.
     */
    async function studyServer() {
        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'study' })
        const serverId: string = created.body.data.id
        const lead = await prisma.role.findFirstOrThrow({ where: { serverId, name: 'Trưởng nhóm' } })
        const { code } = (await newInvite('an', serverId)).body.data as { code: string }
        for (const who of ['binh', 'chi', 'dung'] as const) expect((await join(who, code)).status).toBe(200)
        await prisma.memberRole.create({ data: { serverId, userId: users.binh.id, roleId: lead.id } })
        return { serverId, code, leadId: lead.id }
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        await signUp('an', 'An Nguyễn')
        await signUp('binh', 'Bình Trần')
        await signUp('chi', 'Chi Lê')
        await signUp('dung', 'Dũng Phạm')
        await signUp('phong', 'Phong')
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    afterEach(async () => {
        await prisma.server.deleteMany({ where: { ownerId: { in: Object.values(users).map((user) => user.id) } } })
    })

    it('kicks someone ranked below, who may come back with an invite', async () => {
        const { serverId, code } = await studyServer()
        expect(outcome(await kick('binh', serverId, 'an'))).toEqual([403, 'ROLE_HIERARCHY_VIOLATION'])
        expect(outcome(await kick('chi', serverId, 'dung'))).toEqual([403, 'FORBIDDEN_ERROR'])
        expect(outcome(await kick('binh', serverId, 'chi', 'a'.repeat(513)))).toEqual([422, 'VALIDATION_ERROR'])

        expect((await kick('binh', serverId, 'chi', 'Spam')).status).toBe(200)
        expect(await isMember('chi', serverId)).toBe(false)
        // Out at once: the cached access went with the commit.
        expect(outcome(await as('chi', api().get(url(serverId, '/members'))))).toEqual([404, 'NOT_FOUND_ERROR'])
        expect(outcome(await kick('binh', serverId, 'chi'))).toEqual([404, 'NOT_FOUND_ERROR'])

        expect((await join('chi', code)).status).toBe(200)
        expect(await isMember('chi', serverId)).toBe(true)
    })

    it('bans with a reason, keeps them out until unbanned, and lists who banned', async () => {
        const { serverId, code } = await studyServer()
        // Kicking does not let Bình ban.
        expect(outcome(await ban('binh', serverId, 'dung'))).toEqual([403, 'FORBIDDEN_ERROR'])
        // Only someone in the server (D-155).
        expect(outcome(await ban('an', serverId, 'phong'))).toEqual([404, 'NOT_FOUND_ERROR'])

        expect((await ban('an', serverId, 'dung', '  Bán đề thi có đáp án ')).status).toBe(200)
        expect(await isMember('dung', serverId)).toBe(false)
        expect(outcome(await join('dung', code))).toEqual([403, 'BANNED_FROM_SERVER'])

        const bans = await as('an', api().get(url(serverId, '/bans')))
        expect(bans.status).toBe(200)
        expect(bans.body.data.meta).toMatchObject({ total_items: 1, current_page: 1, items_per_page: 50 })
        expect(bans.body.data.items[0]).toMatchObject({
            user: { user_id: users.dung.id, display_name: 'Dũng Phạm' },
            reason: 'Bán đề thi có đáp án',
            banned_by: { user_id: users.an.id, display_name: 'An Nguyễn' }
        })
        expect(outcome(await as('binh', api().get(url(serverId, '/bans'))))).toEqual([403, 'FORBIDDEN_ERROR'])

        expect((await unban('an', serverId, 'dung')).status).toBe(200)
        expect(outcome(await unban('an', serverId, 'dung'))).toEqual([404, 'NOT_FOUND_ERROR'])
        expect((await join('dung', code)).status).toBe(200)
    })

    it('times out to viewing only, shows it to all and its reason to moderators (D-154)', async () => {
        const { serverId } = await studyServer()
        expect(outcome(await timeout('binh', serverId, 'chi', 120))).toEqual([422, 'VALIDATION_ERROR'])
        expect((await timeout('binh', serverId, 'chi', 3600, 'Gửi tin liên tục')).status).toBe(200)

        // Viewing only: no invite, from the next request.
        expect(outcome(await newInvite('chi', serverId))).toEqual([403, 'FORBIDDEN_ERROR'])
        const shown = (who: Who) =>
            members(who, serverId).then((items) => items.find((item) => item.user_id === users.chi.id)!)
        expect(await shown('dung')).toMatchObject({ timeout_reason: null })
        expect((await shown('dung')).timeout_until).not.toBeNull()
        expect(await shown('binh')).toMatchObject({ timeout_reason: 'Gửi tin liên tục' })
        expect(await shown('chi')).toMatchObject({ timeout_reason: 'Gửi tin liên tục' })

        expect((await timeout('binh', serverId, 'chi', null)).status).toBe(200)
        expect(await shown('binh')).toMatchObject({ timeout_until: null, timeout_reason: null })
        expect((await newInvite('chi', serverId)).ok).toBe(true)
    })

    it('refuses to time out someone holding ADMINISTRATOR (D-147)', async () => {
        const { serverId, leadId } = await studyServer()
        await prisma.role.update({ where: { id: leadId }, data: { permissions: Permission.ADMINISTRATOR } })
        const res = await timeout('an', serverId, 'binh', 60)
        expect(outcome(res)).toEqual([422, 'VALIDATION_ERROR'])
        expect(res.body.data).toMatchObject({ rule: 'target_admin' })
    })

    it('never leaves someone both banned and in the server when a ban races their join', async () => {
        const { serverId, code } = await studyServer()
        for (let round = 0; round < 5; round++) {
            await prisma.ban.deleteMany({ where: { serverId, userId: users.phong.id } })
            await prisma.member.deleteMany({ where: { serverId, userId: users.phong.id } })
            await Promise.all([join('phong', code), ban('an', serverId, 'phong')])
            const banned = (await prisma.ban.count({ where: { serverId, userId: users.phong.id } })) === 1
            expect(banned && (await isMember('phong', serverId))).toBe(false)
        }
    })

    it('sorts the members by role and by the day they joined (D-89)', async () => {
        const { serverId } = await studyServer()
        await prisma.member.update({
            where: { serverId_userId: { serverId, userId: users.chi.id } },
            data: { joinedAt: new Date('2030-01-01T00:00:00Z') }
        })
        const order = async (query: string) => (await members('an', serverId, query)).map((item) => item.user_id)
        const { an, binh, chi, dung } = users
        // Owner, then Trưởng nhóm, then no role; a tie goes by name, A → Z, whichever way the column runs.
        expect(await order('?sort=role&order=desc')).toEqual([an.id, binh.id, chi.id, dung.id])
        expect(await order('?sort=role&order=asc')).toEqual([chi.id, dung.id, binh.id, an.id])
        // An made the server, then Bình, Chi, Dũng joined in turn; Chi's day moved to 2030.
        expect(await order('?sort=joined_at&order=desc')).toEqual([chi.id, dung.id, binh.id, an.id])
        expect(await order('?sort=joined_at&order=asc')).toEqual([an.id, binh.id, dung.id, chi.id])
        expect(await order('?sort=name&order=desc')).toEqual([dung.id, chi.id, binh.id, an.id])
        expect(outcome(await as('an', api().get(url(serverId, '/members?sort=age'))))).toEqual([
            422,
            'VALIDATION_ERROR'
        ])
    })
})
