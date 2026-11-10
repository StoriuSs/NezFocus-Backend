import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { Permission } from '@/modules/permissions'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Server settings › Overview through the whole app (S-SET-01, REQ-SRV-01,
 * D-83): the name as stored, who may change it, the welcome channel and what
 * it may be, and a welcome channel chosen while it is being deleted.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Server overview over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-overview-${randomUUID().slice(0, 8)}`

    type Who = 'an' | 'tuan' | 'phong'
    let app: NestExpressApplication
    let prisma: PrismaService
    const users: Record<Who, { token: string; id: string }> = {} as never

    const api = () => request(app.getHttpServer())
    const as = (who: Who, req: request.Test) =>
        req.set('Authorization', `Bearer ${users[who].token}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const patch = (who: Who, serverId: string, body: object) =>
        as(who, api().patch(`/api/v1/servers/${serverId}`)).send(body)
    const rule = (res: request.Response) => [res.status, res.body.meta?.type, res.body.data?.rule]

    type Server = { id: string; name: string; welcome_channel_id: string | null; channels: { id: string }[] }
    const view = async (who: Who, serverId: string): Promise<Server> => {
        const res = await as(who, api().get('/api/v1/servers'))
        return (res.body.data.servers as Server[]).find((s) => s.id === serverId)!
    }

    async function signUp(who: Who) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, 'Harbour-Lantern-42')
        const me = await api()
            .get('/api/v1/users/me')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Forwarded-For', CLIENT_IP)
            .set('Origin', FRONTEND)
        users[who] = { token: accessToken, id: me.body.data.id }
    }

    /**
     * A Study Server of An's, with `bi-mat` private to Trưởng nhóm; Tuấn in it
     * holding a role that manages the server (not Trưởng nhóm), Phong with no
     * role. Joining comes with invites (L6), so they are added directly.
     */
    async function studyServer() {
        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'study' })
        const serverId: string = created.body.data.id
        const manager = await prisma.role.create({
            data: { serverId, name: 'Quản lý', nameKey: 'quản lý', permissions: Permission.MANAGE_SERVER, position: 2 }
        })
        await prisma.member.createMany({
            data: [
                { serverId, userId: users.tuan.id },
                { serverId, userId: users.phong.id }
            ]
        })
        await prisma.memberRole.create({ data: { serverId, userId: users.tuan.id, roleId: manager.id } })
        const channels = await prisma.channel.findMany({ where: { serverId } })
        const id = (name: string) => channels.find((c) => c.name === name)!.id
        const lead = await prisma.role.findFirstOrThrow({ where: { serverId, name: 'Trưởng nhóm' } })
        await prisma.channel.update({
            where: { id: id('tai-lieu') },
            data: { name: 'bi-mat', nameKey: 'bi-mat', isPrivate: true }
        })
        await prisma.channelViewRole.create({ data: { channelId: id('tai-lieu'), roleId: lead.id, serverId } })
        return { serverId, id: (name: string) => (name === 'bi-mat' ? id('tai-lieu') : id(name)) }
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'tuan', 'phong'] as const) await signUp(who)
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

    it('renames the server as stored, for those who manage it only', async () => {
        const { serverId } = await studyServer()

        const renamed = await patch('tuan', serverId, { name: '  Ôn thi Giải tích 2 – K22 ' })
        expect(renamed.status).toBe(200)
        expect(renamed.body.data.name).toBe('Ôn thi Giải tích 2 – K22')
        expect((await view('phong', serverId)).name).toBe('Ôn thi Giải tích 2 – K22')

        expect(rule(await patch('an', serverId, { name: ' Ô ' }))).toEqual([422, 'VALIDATION_ERROR', 'name_invalid'])
        expect((await patch('phong', serverId, { name: 'Của Phong' })).status).toBe(403)
        const stranger = await patch('an', randomUUID(), { name: 'Không có' })
        expect(stranger.status).toBe(404)
    })

    it('moves the welcome channel to a text channel they see, or to none (D-83)', async () => {
        const { serverId, id } = await studyServer()

        const moved = await patch('an', serverId, { welcome_channel_id: id('hoi-dap') })
        expect(moved.status).toBe(200)
        expect(moved.body.data.welcome_channel_id).toBe(id('hoi-dap'))

        expect(rule(await patch('an', serverId, { welcome_channel_id: id('Phòng học im lặng') }))).toEqual([
            422,
            'VALIDATION_ERROR',
            'not_for_type'
        ])
        // Hidden from Tuấn: as if it did not exist.
        expect((await patch('tuan', serverId, { welcome_channel_id: id('bi-mat') })).status).toBe(404)
        expect((await patch('an', serverId, { welcome_channel_id: 'not-an-id' })).status).toBe(422)

        const off = await patch('an', serverId, { welcome_channel_id: null })
        expect(off.body.data.welcome_channel_id).toBeNull()
    })

    it('tells who manages the server which private channel welcomes, without showing it', async () => {
        const { serverId, id } = await studyServer()
        expect((await patch('an', serverId, { welcome_channel_id: id('bi-mat') })).status).toBe(200)

        const tuan = await view('tuan', serverId)
        expect(tuan.channels.map((c) => c.id)).not.toContain(id('bi-mat'))
        expect(tuan.welcome_channel_id).toBe(id('bi-mat'))
        expect((await view('phong', serverId)).welcome_channel_id).toBeNull()
    })

    it('never welcomes in a channel deleted while it was being chosen', async () => {
        const { serverId, id } = await studyServer()

        const [chosen, deleted] = await Promise.all([
            patch('an', serverId, { welcome_channel_id: id('hoi-dap') }),
            as('an', api().delete(`/api/v1/servers/${serverId}/channels/${id('hoi-dap')}`))
        ])
        expect(deleted.status).toBe(200)
        // Chosen first, then deleted: none (D-83). Deleted first: refused, and the
        // Study Server keeps the welcome channel it was made with.
        expect([200, 404]).toContain(chosen.status)
        const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } })
        expect(stored.welcomeChannelId).toBe(chosen.status === 200 ? null : id('chao-mung'))
    })
})
