import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import sharp from 'sharp'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ALL_PERMISSIONS, Permission } from '@/modules/permissions'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Creating and listing servers through the whole app (S-SRV-01, REQ-SRV-01,
 * REQ-STUDY-08, D-115, D-145): the templates as stored, the list as each
 * member sees it, the 100-server limit under two racing requests, and the
 * icon behind MANAGE_SERVER.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Servers over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-servers-${randomUUID().slice(0, 8)}`

    let app: NestExpressApplication
    let prisma: PrismaService
    const users: Record<'an' | 'phong', { token: string; id: string }> = {} as never

    const api = () => request(app.getHttpServer())
    const as = (who: keyof typeof users, req: request.Test) =>
        req.set('Authorization', `Bearer ${users[who].token}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const create = (who: keyof typeof users, body: object, key: string = randomUUID()) =>
        as(who, api().post('/api/v1/servers')).set('Idempotency-Key', key).send(body)
    const list = async (who: keyof typeof users) => (await as(who, api().get('/api/v1/servers'))).body.data.servers
    const uploadIcon = async (who: keyof typeof users, serverId: string) =>
        as(who, api().post(`/api/v1/servers/${serverId}/icon`))
            .set('Idempotency-Key', randomUUID())
            .attach(
                'icon',
                await sharp({ create: { width: 64, height: 64, channels: 3, background: '#3a7' } })
                    .png()
                    .toBuffer(),
                { filename: 'icon.png', contentType: 'image/png' }
            )
    const typeOf = (res: request.Response) => [res.status, res.body.meta?.type]

    async function signUp(who: keyof typeof users) {
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

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        await signUp('an')
        await signUp('phong')
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

    it('makes a Study Server as REQ-STUDY-08 lists it, the creator its owner holding Trưởng nhóm', async () => {
        const created = await create('an', { name: '  Ôn thi Giải tích 2 ', template: 'study' })
        expect(created.status).toBe(201)
        const server = created.body.data
        expect(server).toMatchObject({ name: 'Ôn thi Giải tích 2', icon_url: null, is_owner: true })
        expect(BigInt(server.permissions)).toBe(ALL_PERMISSIONS)
        expect(server.categories.map((c: { name: string }) => c.name)).toEqual(['Thông tin', 'Phòng học'])

        const channels: { id: string; name: string; type: string; is_study_room: boolean }[] = server.channels
        expect(channels.filter((c) => c.type === 'text').map((c) => c.name)).toEqual([
            'chao-mung',
            'thong-bao',
            'tai-lieu',
            'hoi-dap',
            'viec-nhom'
        ])
        expect(channels.filter((c) => c.type === 'voice' && c.is_study_room)).toHaveLength(2)
        expect(server.welcome_channel_id).toBe(channels.find((c) => c.name === 'chao-mung')!.id)

        const stored = await prisma.server.findUniqueOrThrow({
            where: { id: server.id },
            select: {
                welcomeChannel: { select: { name: true } },
                roles: {
                    select: { name: true, isEveryone: true, position: true, members: { select: { userId: true } } }
                }
            }
        })
        expect(stored.welcomeChannel?.name).toBe('chao-mung')
        const lead = stored.roles.find((role) => role.name === 'Trưởng nhóm')!
        expect(lead.position).toBe(1)
        expect(lead.members.map((m) => m.userId)).toEqual([users.an.id])
        expect(stored.roles.filter((role) => role.isEveryone)).toHaveLength(1)
    })

    it('makes a plain server with chung and a voice room, and lists servers in the order they were joined', async () => {
        const study = (await create('an', { name: 'Ôn thi', template: 'study' })).body.data
        const plain = await create('an', { name: 'Nhóm chơi', template: 'standard' })
        expect(plain.status).toBe(201)
        expect(plain.body.data.categories).toEqual([])
        expect(plain.body.data.channels.map((c: { type: string; name: string }) => [c.type, c.name])).toEqual([
            ['text', 'chung'],
            ['voice', 'Phòng thoại chung']
        ])
        expect((await list('an')).map((s: { id: string }) => s.id)).toEqual([study.id, plain.body.data.id])
    })

    it('refuses a name too short or blank, and a template that does not exist, creating nothing', async () => {
        for (const body of [
            { name: 'Ô', template: 'study' },
            { name: '   ', template: 'study' },
            { name: 'a'.repeat(101), template: 'study' },
            { name: 'Ôn thi', template: 'gaming' }
        ]) {
            expect(typeOf(await create('an', body))).toEqual([422, 'VALIDATION_ERROR'])
        }
        expect(await list('an')).toEqual([])
    })

    it('makes one server for one Idempotency-Key, sent twice', async () => {
        const key = randomUUID()
        const first = await create('an', { name: 'Ôn thi', template: 'standard' }, key)
        const again = await create('an', { name: 'Ôn thi', template: 'standard' }, key)
        expect(again.body.data.id).toBe(first.body.data.id)
        expect(await list('an')).toHaveLength(1)
    })

    it('lets only one of two racing requests make the 100th server', async () => {
        const seeded = await prisma.server.createManyAndReturn({
            data: Array.from({ length: 99 }, (_, i) => ({ name: `Seed ${i}`, ownerId: users.an.id })),
            select: { id: true }
        })
        await prisma.member.createMany({ data: seeded.map((s) => ({ serverId: s.id, userId: users.an.id })) })

        const results = await Promise.all([
            create('an', { name: 'Thứ 100', template: 'standard' }),
            create('an', { name: 'Thứ 101', template: 'standard' })
        ])
        expect(results.map((r) => r.status).sort()).toEqual([201, 403])
        expect(results.map((r) => r.body.meta?.type)).toContain('MAX_SERVERS_REACHED')
        expect(await prisma.member.count({ where: { userId: users.an.id } })).toBe(100)
    })

    it('does not count a deleted server toward the limit, nor list it', async () => {
        const server = (await create('an', { name: 'Đã xóa', template: 'standard' })).body.data
        await prisma.server.update({ where: { id: server.id }, data: { deletedAt: new Date() } })
        expect(await list('an')).toEqual([])
        expect(typeOf(await uploadIcon('an', server.id))).toEqual([404, 'NOT_FOUND_ERROR'])
    })

    it('shows a member only the channels they may see, with what they may do there', async () => {
        const server = (await create('an', { name: 'Ôn thi', template: 'study' })).body.data
        const staff = await prisma.category.create({
            data: { serverId: server.id, name: 'Ban quản trị', nameKey: 'ban quản trị', position: 2 }
        })
        await prisma.channel.create({
            data: {
                serverId: server.id,
                categoryId: staff.id,
                type: 'text',
                name: 'phong-mod',
                nameKey: 'phong-mod',
                position: 0,
                isPrivate: true
            }
        })
        await prisma.member.create({ data: { serverId: server.id, userId: users.phong.id } })

        const [seen] = await list('phong')
        expect(seen).toMatchObject({ id: server.id, is_owner: false, top_role_position: 0 })
        expect(seen.channels.map((c: { name: string }) => c.name)).not.toContain('phong-mod')
        expect(seen.categories.map((c: { name: string }) => c.name)).toEqual(['Thông tin', 'Phòng học'])
        const announcements = seen.channels.find((c: { name: string }) => c.name === 'thong-bao')
        expect(BigInt(announcements.permissions) & Permission.SEND_MESSAGES).toBe(0n)
        expect(BigInt(seen.permissions) & Permission.MANAGE_SERVER).toBe(0n)

        const [owned] = await list('an')
        expect(owned.channels.map((c: { name: string }) => c.name)).toContain('phong-mod')
    })

    it('takes an icon from the owner, not from a member without MANAGE_SERVER, nor from a stranger', async () => {
        const server = (await create('an', { name: 'Ôn thi', template: 'standard' })).body.data

        expect(typeOf(await uploadIcon('phong', server.id))).toEqual([404, 'NOT_FOUND_ERROR'])
        await prisma.member.create({ data: { serverId: server.id, userId: users.phong.id } })
        expect(typeOf(await uploadIcon('phong', server.id))).toEqual([403, 'FORBIDDEN_ERROR'])

        const uploaded = await uploadIcon('an', server.id)
        expect(uploaded.status).toBe(200)
        expect(uploaded.body.data.icon_url).toEqual(expect.any(String))
        expect((await list('an'))[0].icon_url).toEqual(expect.any(String))

        const removed = await as('an', api().delete(`/api/v1/servers/${server.id}/icon`))
        expect(removed.status).toBe(200)
        expect((await list('an'))[0].icon_url).toBeNull()
    })
})
