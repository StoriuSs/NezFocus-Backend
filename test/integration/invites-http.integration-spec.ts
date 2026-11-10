import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { Permission, PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Invite links through the whole app (REQ-SRV-03, SRV-04, D-150, D-151):
 * handing a link out again, the public page and its target channel, joining
 * (once, as a member, used up, expired, revoked, deleted server), the race
 * for the last use, banned and 100 servers, who may revoke and list, and the
 * limit on wrong codes per network.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Invites over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-invites-${randomUUID().slice(0, 8)}`
    const DAY = 24 * 60 * 60

    type Who = 'an' | 'binh' | 'tuan' | 'phong'
    let app: NestExpressApplication
    let prisma: PrismaService
    const users: Record<Who, { token: string; id: string; username: string }> = {} as never

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test, ip = CLIENT_IP) => req.set('X-Forwarded-For', ip).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const invite = (who: Who, serverId: string, maxAgeSeconds: number | null, maxUses: number | null) =>
        as(who, api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: maxAgeSeconds, max_uses: maxUses })
    const accept = (who: Who, code: string) => as(who, api().post(`/api/v1/invites/${code}/accept`))
    const page = (code: string, query = '', ip = CLIENT_IP) => anyone(api().get(`/api/v1/invites/${code}${query}`), ip)
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]
    const uses = async (code: string) => (await prisma.invite.findUniqueOrThrow({ where: { code } })).uses
    const isMember = async (serverId: string, who: Who) =>
        (await prisma.member.count({ where: { serverId, userId: users[who].id } })) === 1

    async function signUp(who: Who) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        const username = await completeAccount(post, accessToken, 'Harbour-Lantern-42')
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id, username }
    }

    /** An's Study Server, with `tai-lieu` private to Trưởng nhóm. */
    async function studyServer() {
        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'study' })
        const serverId: string = created.body.data.id
        const channels = await prisma.channel.findMany({ where: { serverId } })
        const id = (name: string) => channels.find((c) => c.name === name)!.id
        const lead = await prisma.role.findFirstOrThrow({ where: { serverId, name: 'Trưởng nhóm' } })
        await prisma.channel.update({ where: { id: id('tai-lieu') }, data: { isPrivate: true } })
        await prisma.channelViewRole.create({ data: { channelId: id('tai-lieu'), roleId: lead.id, serverId } })
        return { serverId, id }
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'tuan', 'phong'] as const) await signUp(who)
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

    it('hands out their unlimited link again while half its time is left, and a new one otherwise', async () => {
        const { serverId } = await studyServer()

        const first = await invite('an', serverId, 7 * DAY, null)
        expect(first.status).toBe(200)
        expect(first.body.data).toMatchObject({ max_age_seconds: 7 * DAY, max_uses: null, uses: 0 })
        expect(first.body.data.code).toMatch(/^[A-Za-z0-9]{8}$/)
        const code: string = first.body.data.code
        expect((await invite('an', serverId, 7 * DAY, null)).body.data.code).toBe(code)

        // Another lifetime, a limit on uses: new links; a limited one is never handed out twice.
        expect((await invite('an', serverId, DAY, null)).body.data.code).not.toBe(code)
        const once = (await invite('an', serverId, 7 * DAY, 1)).body.data.code
        expect((await invite('an', serverId, 7 * DAY, 1)).body.data.code).not.toBe(once)

        // Under half its time left: a new one.
        await prisma.invite.update({
            where: { code },
            data: { expiresAt: new Date(Date.now() + 3 * DAY * 1000) }
        })
        expect((await invite('an', serverId, 7 * DAY, null)).body.data.code).not.toBe(code)

        // Lifetimes outside the list, or more than 100 uses, are refused.
        expect((await invite('an', serverId, 2 * DAY, null)).status).toBe(422)
        expect((await invite('an', serverId, null, 101)).status).toBe(422)
    })

    it('shows the invite page to anyone, with the inviter and a target someone joining sees', async () => {
        const { serverId, id } = await studyServer()
        const code: string = (await invite('an', serverId, null, null)).body.data.code

        const res = await page(code, `?channel=${id('hoi-dap')}`)
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({
            code,
            server: { id: serverId, name: 'Ôn thi Giải tích 2', icon_url: null, member_count: 1 },
            inviter_name: 'Ada',
            channel: { id: id('hoi-dap'), name: 'hoi-dap', type: 'text', is_study_room: false }
        })
        const room = (await page(code, `?channel=${id('Phòng học im lặng')}`)).body.data.channel
        expect(room).toMatchObject({ type: 'voice', is_study_room: true })

        // Private, another server's or made up: no target.
        expect((await page(code, `?channel=${id('tai-lieu')}`)).body.data.channel).toBeNull()
        expect((await page(code, `?channel=${randomUUID()}`)).body.data.channel).toBeNull()

        // The creator has left: no inviter (D-81).
        const own: string = (await invite('an', serverId, null, 5)).body.data.code
        await prisma.server.update({ where: { id: serverId }, data: { ownerId: users.binh.id } })
        await prisma.member.create({ data: { serverId, userId: users.binh.id } })
        await prisma.member.delete({ where: { serverId_userId: { serverId, userId: users.an.id } } })
        expect((await page(own)).body.data.inviter_name).toBeNull()
    })

    it('joins once; a member goes through without a use; used up, expired and revoked links are refused', async () => {
        const { serverId } = await studyServer()
        const code: string = (await invite('an', serverId, 7 * DAY, 1)).body.data.code

        const joined = await accept('binh', code)
        expect(joined.status).toBe(200)
        expect(joined.body.data.joined).toBe(true)
        expect(joined.body.data.server).toMatchObject({ id: serverId, name: 'Ôn thi Giải tích 2' })
        expect(await uses(code)).toBe(1)

        // A member, even on a link now used up: refused as invalid (one answer for everyone).
        expect(outcome(await accept('binh', code))).toEqual([410, 'INVITE_INVALID'])
        expect(outcome(await accept('tuan', code))).toEqual([410, 'INVITE_INVALID'])
        expect(outcome(await page(code))).toEqual([410, 'INVITE_INVALID'])

        // A member on a live link: through, nothing counted.
        const open: string = (await invite('an', serverId, null, null)).body.data.code
        const again = await accept('binh', open)
        expect([again.status, again.body.data.joined]).toEqual([200, false])
        expect(await uses(open)).toBe(0)

        const expiring: string = (await invite('an', serverId, 30 * 60, null)).body.data.code
        await prisma.invite.update({ where: { code: expiring }, data: { expiresAt: new Date(Date.now() - 1000) } })
        expect(outcome(await accept('tuan', expiring))).toEqual([410, 'INVITE_INVALID'])

        const revoked: string = (await invite('an', serverId, DAY, 10)).body.data.code
        expect((await as('an', api().delete(`/api/v1/invites/${revoked}`))).status).toBe(200)
        expect(outcome(await accept('tuan', revoked))).toEqual([410, 'INVITE_INVALID'])
        expect(await isMember(serverId, 'tuan')).toBe(false)

        await prisma.server.update({ where: { id: serverId }, data: { deletedAt: new Date() } })
        expect(outcome(await page(open))).toEqual([410, 'INVITE_INVALID'])
        expect(outcome(await accept('tuan', open))).toEqual([410, 'INVITE_INVALID'])
    })

    it('lets exactly one of two people racing take the last use', async () => {
        const { serverId } = await studyServer()
        const code: string = (await invite('an', serverId, null, 1)).body.data.code

        const results = await Promise.all([accept('binh', code), accept('tuan', code)])
        expect(results.map((r) => r.status).sort()).toEqual([200, 410])
        expect(await uses(code)).toBe(1)
        expect(await prisma.member.count({ where: { serverId } })).toBe(2)
    })

    it('refuses someone banned, and someone already in 100 servers, without using up a use', async () => {
        const { serverId } = await studyServer()
        const code: string = (await invite('an', serverId, null, 10)).body.data.code

        await prisma.ban.create({ data: { serverId, userId: users.phong.id, bannedById: users.an.id } })
        expect(outcome(await accept('phong', code))).toEqual([403, 'BANNED_FROM_SERVER'])

        const seeded = await prisma.server.createManyAndReturn({
            data: Array.from({ length: 100 }, (_, i) => ({ name: `Seed ${i}`, ownerId: users.tuan.id })),
            select: { id: true }
        })
        await prisma.member.createMany({ data: seeded.map((s) => ({ serverId: s.id, userId: users.tuan.id })) })
        expect(outcome(await accept('tuan', code))).toEqual([403, 'MAX_SERVERS_REACHED'])

        expect(await uses(code)).toBe(0)
        expect(await isMember(serverId, 'phong')).toBe(false)
    })

    it('lets only one of two joins at once make the 100th server', async () => {
        const first = await studyServer()
        const second = await studyServer()
        const codes = await Promise.all(
            [first, second].map(async ({ serverId }) => (await invite('an', serverId, null, null)).body.data.code)
        )
        const seeded = await prisma.server.createManyAndReturn({
            data: Array.from({ length: 99 }, (_, i) => ({ name: `Seed ${i}`, ownerId: users.tuan.id })),
            select: { id: true }
        })
        await prisma.member.createMany({ data: seeded.map((s) => ({ serverId: s.id, userId: users.tuan.id })) })

        const results = await Promise.all(codes.map((code) => accept('tuan', code)))
        expect(results.map((r) => r.status).sort()).toEqual([200, 403])
        expect(await prisma.member.count({ where: { userId: users.tuan.id, server: { deletedAt: null } } })).toBe(100)
    })

    it('lets the creator or a manager revoke, and only managers list the links that still open', async () => {
        const { serverId } = await studyServer()
        const manager = await prisma.role.create({
            data: { serverId, name: 'Quản lý', nameKey: 'quản lý', permissions: Permission.MANAGE_SERVER, position: 2 }
        })
        await prisma.member.createMany({
            data: [
                { serverId, userId: users.binh.id },
                { serverId, userId: users.phong.id },
                { serverId, userId: users.tuan.id }
            ]
        })
        await prisma.memberRole.create({ data: { serverId, userId: users.tuan.id, roleId: manager.id } })

        // Bình holds CREATE_INVITE through @everyone (appendix B).
        const binhs: string = (await invite('binh', serverId, DAY, null)).body.data.code
        const ans: string = (await invite('an', serverId, null, 5)).body.data.code
        const usedUp: string = (await invite('an', serverId, null, 1)).body.data.code
        await prisma.invite.update({ where: { code: usedUp }, data: { uses: 1 } })

        expect(outcome(await as('phong', api().delete(`/api/v1/invites/${binhs}`)))).toEqual([403, 'FORBIDDEN_ERROR'])
        expect(outcome(await as('phong', api().get(`/api/v1/servers/${serverId}/invites`)))).toEqual([
            403,
            'FORBIDDEN_ERROR'
        ])

        const listed = await as('tuan', api().get(`/api/v1/servers/${serverId}/invites`))
        expect(listed.status).toBe(200)
        expect(listed.body.data.invites.map((i: { code: string }) => i.code)).toEqual([ans, binhs])
        expect(listed.body.data.invites[1].creator).toEqual({
            state: 'member',
            display_name: 'Ada',
            username: users.binh.username
        })

        // Bình leaves (as leaving will in L9, telling the permission cache): the link stays, without a name.
        await prisma.member.delete({ where: { serverId_userId: { serverId, userId: users.binh.id } } })
        await app.get<PermissionCachePort>(PERMISSION_CACHE).memberChanged(serverId, users.binh.id)
        const after = await as('tuan', api().get(`/api/v1/servers/${serverId}/invites`))
        expect(after.body.data.invites[1].creator).toEqual({ state: 'left' })

        // Outside the server now: answered as for a code that does not exist.
        expect(outcome(await as('binh', api().delete(`/api/v1/invites/${ans}`)))).toEqual([410, 'INVITE_INVALID'])
        expect((await as('tuan', api().delete(`/api/v1/invites/${binhs}`))).status).toBe(200)
        expect((await as('an', api().delete(`/api/v1/invites/${ans}`))).status).toBe(200)
        // Already gone, or used up: says so, for the page to drop the row.
        expect(outcome(await as('an', api().delete(`/api/v1/invites/${ans}`)))).toEqual([410, 'INVITE_INVALID'])
        expect(outcome(await as('an', api().delete(`/api/v1/invites/${usedUp}`)))).toEqual([410, 'INVITE_INVALID'])
    })

    it('refuses more than 30 wrong codes a minute from one network; good codes do not count', async () => {
        const { serverId } = await studyServer()
        const code: string = (await invite('an', serverId, null, null)).body.data.code
        const ip = testClientIp()

        for (let i = 0; i < 3; i++) expect((await page(code, '', ip)).status).toBe(200)
        for (let i = 0; i < 30; i++) {
            const wrong = i % 2 === 0 ? `Zz${i}xxxxxx`.slice(0, 8) : 'not-a-code'
            expect(outcome(await page(wrong, '', ip))).toEqual([410, 'INVITE_INVALID'])
        }
        const refused = await page(code, '', ip)
        expect(outcome(refused)).toEqual([429, 'RATE_LIMIT_EXCEEDED'])
        expect(refused.body.data.reason).toBe('network')
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)

        // Joining counts against the same allowance.
        expect(outcome(await anyone(accept('binh', code), ip))).toEqual([429, 'RATE_LIMIT_EXCEEDED'])
        // Another network is not affected.
        expect((await page(code)).status).toBe(200)
    })
})
