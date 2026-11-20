import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { Permission } from '@/modules/permissions'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Categories and channels through the whole app (REQ-SRV-02, D-84, D-149):
 * names as stored, clashes refused by the rule and by the database, private
 * channels by role, one move per drop with a hidden channel left in place,
 * deleting a category or the welcome channel, and two changes racing on one
 * server.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Channel list over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-layout-${randomUUID().slice(0, 8)}`

    type Who = 'an' | 'chi' | 'phong'
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
    const send = (who: Who, method: 'post' | 'patch' | 'delete', path: string, body: object = {}) => {
        const req = as(who, api()[method](`/api/v1/servers${path ? `/${path}` : ''}`))
        return (method === 'post' ? req.set('Idempotency-Key', randomUUID()) : req).send(body)
    }
    const rule = (res: request.Response) => [res.status, res.body.meta?.type, res.body.data?.rule]

    type Channel = {
        id: string
        name: string
        category_id: string | null
        type: string
        view_role_ids: string[] | null
    }
    type Server = {
        id: string
        welcome_channel_id: string | null
        categories: { id: string; name: string }[]
        channels: Channel[]
        roles: { id: string; name: string }[]
    }
    const view = async (who: Who, serverId: string): Promise<Server> => {
        const res = await as(who, api().get('/api/v1/servers'))
        return (res.body.data.servers as Server[]).find((s) => s.id === serverId)!
    }
    /** Channel names group by group, as the list shows them: outside any category first. */
    const layout = (server: Server) => {
        const names = (categoryId: string | null) =>
            server.channels.filter((c) => c.category_id === categoryId).map((c) => c.name)
        return [['-', names(null)], ...server.categories.map((c) => [c.name, names(c.id)])]
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
     * A Study Server of An's, with Chi in it holding a role that manages
     * channels (but not Trưởng nhóm) and Phong with no role. Joining comes
     * with invites (L6), so they are added directly.
     */
    async function studyServer() {
        const created = await send('an', 'post', '', { name: 'Ôn thi Giải tích 2', template: 'study' })
        const server = await prisma.server.findUniqueOrThrow({
            where: { id: created.body.data.id },
            include: { categories: true }
        })
        const helper = await prisma.role.create({
            data: {
                serverId: server.id,
                name: 'Điều phối',
                nameKey: 'điều phối',
                permissions: Permission.MANAGE_CHANNELS,
                position: 2
            }
        })
        await prisma.member.createMany({
            data: [
                { serverId: server.id, userId: users.chi.id },
                { serverId: server.id, userId: users.phong.id }
            ]
        })
        await prisma.memberRole.create({ data: { serverId: server.id, userId: users.chi.id, roleId: helper.id } })
        const lead = await prisma.role.findFirstOrThrow({ where: { serverId: server.id, name: 'Trưởng nhóm' } })
        const info = server.categories.find((c) => c.name === 'Thông tin')!
        const rooms = server.categories.find((c) => c.name === 'Phòng học')!
        return { serverId: server.id, info: info.id, rooms: rooms.id, lead: lead.id, helper: helper.id }
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'chi', 'phong'] as const) await signUp(who)
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

    it('creates categories and channels with their names as REQ-SRV-02 stores them, refusing clashes', async () => {
        const { serverId, info } = await studyServer()

        const category = await send('chi', 'post', `${serverId}/categories`, { name: '  Ôn tập cuối kỳ ' })
        expect(category.status).toBe(201)
        expect(category.body.data.server.categories.map((c: { name: string }) => c.name)).toEqual([
            'Thông tin',
            'Phòng học',
            'Ôn tập cuối kỳ'
        ])
        expect(rule(await send('chi', 'post', `${serverId}/categories`, { name: 'THÔNG TIN' }))).toEqual([
            422,
            'VALIDATION_ERROR',
            'name_taken'
        ])

        const text = await send('chi', 'post', `${serverId}/channels`, {
            type: 'text',
            name: 'Hỏi Đáp Chung',
            category_id: info
        })
        expect(text.status).toBe(201)
        const made = text.body.data.server.channels.find((c: Channel) => c.id === text.body.data.id)
        expect(made).toMatchObject({ name: 'hỏi-đáp-chung', category_id: info, type: 'text' })

        // Another case clashes; other accents do not; outside the category it is free.
        const clash = await send('chi', 'post', `${serverId}/channels`, {
            type: 'text',
            name: 'Tai Lieu',
            category_id: info
        })
        expect(rule(clash)).toEqual([422, 'VALIDATION_ERROR', 'name_taken'])
        expect(
            (await send('chi', 'post', `${serverId}/channels`, { type: 'text', name: 'Tài liệu', category_id: info }))
                .status
        ).toBe(201)
        expect((await send('chi', 'post', `${serverId}/channels`, { type: 'text', name: 'tai lieu' })).status).toBe(201)
        expect(rule(await send('chi', 'post', `${serverId}/channels`, { type: 'text', name: '???' }))).toEqual([
            422,
            'VALIDATION_ERROR',
            'name_invalid'
        ])
    })

    it('lets only MANAGE_CHANNELS change the list, and answers NOT_FOUND to a stranger', async () => {
        const { serverId, info } = await studyServer()
        const res = await send('phong', 'post', `${serverId}/channels`, { type: 'text', name: 'x', category_id: info })
        expect([res.status, res.body.meta.type]).toEqual([403, 'FORBIDDEN_ERROR'])
        await prisma.member.delete({ where: { serverId_userId: { serverId, userId: users.phong.id } } })
        const stranger = await send('phong', 'post', `${serverId}/categories`, { name: 'x' })
        expect(stranger.status).toBe(404)
    })

    it('shows a private channel only to its roles and the owner, and to all once public again', async () => {
        const { serverId, info, lead } = await studyServer()
        const created = await send('an', 'post', `${serverId}/channels`, {
            type: 'text',
            name: 'ban-can-su',
            category_id: info,
            is_private: true,
            view_role_ids: [lead]
        })
        const id = created.body.data.id
        expect(created.body.data.server.channels.find((c: Channel) => c.id === id).view_role_ids).toEqual([lead])
        expect((await view('phong', serverId)).channels.some((c) => c.id === id)).toBe(false)
        expect((await view('chi', serverId)).channels.some((c) => c.id === id)).toBe(false)
        // Hidden from Chi even though she manages channels: not found, not forbidden.
        expect((await send('chi', 'delete', `${serverId}/channels/${id}`)).status).toBe(404)

        const everyone = await prisma.role.findFirstOrThrow({ where: { serverId, isEveryone: true } })
        const refused = await send('an', 'patch', `${serverId}/channels/${id}`, { view_role_ids: [everyone.id] })
        expect(rule(refused)).toEqual([422, 'VALIDATION_ERROR', 'view_roles'])

        expect((await send('an', 'patch', `${serverId}/channels/${id}`, { is_private: false })).status).toBe(200)
        expect((await view('phong', serverId)).channels.find((c) => c.id === id)?.view_role_ids).toBeNull()
        expect(await prisma.channelViewRole.count({ where: { channelId: id } })).toBe(0)
    })

    describe('room settings (S-SET-06, REQ-STUDY-01, D-210)', () => {
        type Room = Channel & {
            is_study_room: boolean
            study_starter: string
            study_focus_minutes: number
            study_short_break_minutes: number
            study_long_break_minutes: number | null
            study_long_break_every: number | null
        }
        const roomIn = async (who: Who, serverId: string, name: string) =>
            (await view(who, serverId)).channels.find((c) => c.name === name) as Room

        it('saves who may start and the cycle, and turns the study room off and on again', async () => {
            const { serverId } = await studyServer()
            const room = await roomIn('an', serverId, 'Phòng học im lặng')
            expect(room).toMatchObject({
                is_study_room: true,
                study_starter: 'anyone',
                study_focus_minutes: 25,
                study_short_break_minutes: 5,
                study_long_break_minutes: null,
                study_long_break_every: null
            })

            const saved = await send('chi', 'patch', `${serverId}/channels/${room.id}`, {
                study_starter: 'managers',
                study_focus_minutes: 50,
                study_short_break_minutes: 10,
                study_long_break_minutes: 20,
                study_long_break_every: 4
            })
            expect(saved.status).toBe(200)
            expect(await roomIn('phong', serverId, 'Phòng học im lặng')).toMatchObject({
                study_starter: 'managers',
                study_focus_minutes: 50,
                study_long_break_minutes: 20,
                study_long_break_every: 4
            })

            const off = await send('an', 'patch', `${serverId}/channels/${room.id}`, {
                is_study_room: false,
                study_long_break_minutes: null,
                study_long_break_every: null
            })
            expect(off.status).toBe(200)
            expect(await roomIn('an', serverId, 'Phòng học im lặng')).toMatchObject({
                is_study_room: false,
                study_focus_minutes: 50,
                study_long_break_minutes: null
            })

            const on = await send('an', 'patch', `${serverId}/channels/${room.id}`, { is_study_room: true })
            expect(on.status).toBe(200)
            expect(await roomIn('an', serverId, 'Phòng học im lặng')).toMatchObject({
                is_study_room: true,
                study_starter: 'managers',
                study_focus_minutes: 50
            })
        })

        it('refuses a cycle out of range, half a long break, and study settings on a text channel', async () => {
            const { serverId } = await studyServer()
            const room = await roomIn('an', serverId, 'Phòng học im lặng')
            const text = await roomIn('an', serverId, 'hoi-dap')
            const patch = (id: string, body: object) => send('an', 'patch', `${serverId}/channels/${id}`, body)

            expect((await patch(room.id, { study_focus_minutes: 150 })).status).toBe(422)
            expect((await patch(room.id, { study_long_break_every: 9, study_long_break_minutes: 15 })).status).toBe(422)
            expect(rule(await patch(room.id, { study_long_break_minutes: 15 }))).toEqual([
                422,
                'VALIDATION_ERROR',
                'study_cycle'
            ])
            expect(rule(await patch(text.id, { is_study_room: true }))).toEqual([
                422,
                'VALIDATION_ERROR',
                'not_for_type'
            ])
        })

        it('answers VALIDATION_ERROR, not a server error, to null where a value is needed', async () => {
            const { serverId } = await studyServer()
            const room = await roomIn('an', serverId, 'Phòng học im lặng')
            const text = await roomIn('an', serverId, 'hoi-dap')
            for (const [id, body] of [
                [text.id, { name: null }],
                [text.id, { send_mode: null }],
                [text.id, { task_board_enabled: null }],
                [room.id, { is_study_room: null }],
                [room.id, { study_starter: null }],
                [room.id, { study_focus_minutes: null }],
                [room.id, { study_short_break_minutes: null }]
            ] as const) {
                const res = await send('an', 'patch', `${serverId}/channels/${id}`, body)
                expect([Object.keys(body)[0], res.status, res.body.meta?.type]).toEqual([
                    Object.keys(body)[0],
                    422,
                    'VALIDATION_ERROR'
                ])
            }
        })

        it('lets MANAGE_STUDY_ROOMS change only the study part of a room (study-only)', async () => {
            const { serverId } = await studyServer()
            const coach = await prisma.role.create({
                data: {
                    serverId,
                    name: 'Điều phối phòng học',
                    nameKey: 'điều phối phòng học',
                    permissions: Permission.MANAGE_STUDY_ROOMS,
                    position: 3
                }
            })
            await prisma.memberRole.create({ data: { serverId, userId: users.phong.id, roleId: coach.id } })
            const room = await roomIn('phong', serverId, 'Phòng học im lặng')
            const text = await roomIn('phong', serverId, 'hoi-dap')
            const patch = (id: string, body: object) => send('phong', 'patch', `${serverId}/channels/${id}`, body)

            expect((await patch(room.id, { study_starter: 'managers', study_focus_minutes: 45 })).status).toBe(200)
            expect((await patch(room.id, { name: 'Phòng học im lặng' })).status).toBe(200)
            const rename = await patch(room.id, { name: 'Phòng mới' })
            expect([rename.status, rename.body.meta.type]).toEqual([403, 'FORBIDDEN_ERROR'])
            expect((await patch(text.id, { task_board_enabled: true })).status).toBe(403)
            expect((await send('phong', 'delete', `${serverId}/channels/${room.id}`)).status).toBe(403)
            expect(await roomIn('an', serverId, 'Phòng học im lặng')).toMatchObject({
                name: 'Phòng học im lặng',
                study_starter: 'managers',
                study_focus_minutes: 45
            })
        })

        it('the database keeps the cycle in range and the long break whole (Channel_study_cycle_check)', async () => {
            const { serverId } = await studyServer()
            const room = await roomIn('an', serverId, 'Phòng học im lặng')
            type DatabaseError = { meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } }
            const refusedBy = (data: object): Promise<string> =>
                prisma.channel.update({ where: { id: room.id }, data, select: { id: true } }).then(
                    () => 'written',
                    (error: DatabaseError) => {
                        const said = error.meta?.driverAdapterError?.cause?.originalMessage ?? String(error)
                        return /constraint "([^"]+)"/.exec(said)?.[1] ?? said
                    }
                )
            expect(await refusedBy({ studyFocusMinutes: 120, studyShortBreakMinutes: 30 })).toBe('written')
            expect(await refusedBy({ studyLongBreakMinutes: 60, studyLongBreakEvery: 8 })).toBe('written')
            expect(await refusedBy({ studyLongBreakMinutes: null, studyLongBreakEvery: null })).toBe('written')
            for (const wrong of [
                { studyFocusMinutes: 4 },
                { studyFocusMinutes: 121 },
                { studyShortBreakMinutes: 0 },
                { studyShortBreakMinutes: 31 },
                { studyLongBreakMinutes: 15 },
                { studyLongBreakEvery: 4 },
                { studyLongBreakMinutes: 4, studyLongBreakEvery: 4 },
                { studyLongBreakMinutes: 61, studyLongBreakEvery: 4 },
                { studyLongBreakMinutes: 15, studyLongBreakEvery: 1 },
                { studyLongBreakMinutes: 15, studyLongBreakEvery: 9 }
            ]) {
                expect([wrong, await refusedBy(wrong)]).toEqual([wrong, 'Channel_study_cycle_check'])
            }
        })
    })

    it('moves one channel per drop, leaving a channel the mover cannot see where it was (D-149)', async () => {
        const { serverId, info, rooms, lead } = await studyServer()
        const secret = await send('an', 'post', `${serverId}/channels`, {
            type: 'text',
            name: 'bi-mat',
            category_id: info,
            is_private: true,
            view_role_ids: [lead]
        })
        const chi = await view('chi', serverId)
        const id = (name: string) => chi.channels.find((c) => c.name === name)!.id

        // Chi drops chao-mung after viec-nhom, the last channel she sees in THÔNG TIN.
        const moved = await send('chi', 'patch', `${serverId}/channels/order`, {
            kind: 'channel',
            id: id('chao-mung'),
            category_id: info,
            after_id: id('viec-nhom')
        })
        expect(moved.status).toBe(200)
        expect(layout(await view('an', serverId))[1]).toEqual([
            'Thông tin',
            ['thong-bao', 'tai-lieu', 'hoi-dap', 'viec-nhom', 'chao-mung', 'bi-mat']
        ])
        expect(secret.status).toBe(201)

        // Into another category, then out of all of them.
        await send('chi', 'patch', `${serverId}/channels/order`, {
            kind: 'channel',
            id: id('hoi-dap'),
            category_id: rooms,
            after_id: null
        })
        await send('chi', 'patch', `${serverId}/channels/order`, {
            kind: 'channel',
            id: id('tai-lieu'),
            category_id: null,
            after_id: null
        })
        expect(layout(await view('chi', serverId))).toEqual([
            ['-', ['tai-lieu']],
            ['Thông tin', ['thong-bao', 'viec-nhom', 'chao-mung']],
            ['Phòng học', ['hoi-dap', 'Phòng học im lặng', 'Phòng thảo luận nhóm']]
        ])

        // A drop place that left the group: refused, nothing moves.
        const stale = await send('chi', 'patch', `${serverId}/channels/order`, {
            kind: 'channel',
            id: id('thong-bao'),
            category_id: info,
            after_id: id('hoi-dap')
        })
        expect(rule(stale)).toEqual([422, 'VALIDATION_ERROR', 'stale_move'])

        // Categories: PHÒNG HỌC first.
        await send('chi', 'patch', `${serverId}/channels/order`, { kind: 'category', id: rooms, after_id: null })
        expect((await view('phong', serverId)).categories.map((c) => c.name)).toEqual(['Phòng học', 'Thông tin'])
        // category_id must be said, even as null.
        const vague = await send('chi', 'patch', `${serverId}/channels/order`, {
            kind: 'channel',
            id: id('thong-bao'),
            after_id: null
        })
        expect(vague.status).toBe(422)
    })

    it('deleting a category moves its channels to the top, unless a name would clash there', async () => {
        const { serverId, info } = await studyServer()
        await send('an', 'post', `${serverId}/channels`, { type: 'text', name: 'hoi-dap' })
        const blocked = await send('an', 'delete', `${serverId}/categories/${info}`)
        expect(rule(blocked)).toEqual([422, 'VALIDATION_ERROR', 'name_taken'])
        expect(blocked.body.data.names).toEqual(['hoi-dap'])

        const outside = (await view('an', serverId)).channels.find((c) => c.category_id === null)!
        await send('an', 'delete', `${serverId}/channels/${outside.id}`)
        const deleted = await send('an', 'delete', `${serverId}/categories/${info}`)
        expect(deleted.status).toBe(200)
        expect(layout(deleted.body.data as Server)[0]).toEqual([
            '-',
            ['chao-mung', 'thong-bao', 'tai-lieu', 'hoi-dap', 'viec-nhom']
        ])
    })

    it('deleting the welcome channel leaves the server sending none (D-83)', async () => {
        const { serverId } = await studyServer()
        const before = await view('an', serverId)
        const deleted = await send('an', 'delete', `${serverId}/channels/${before.welcome_channel_id}`)
        expect(deleted.status).toBe(200)
        expect(deleted.body.data.welcome_channel_id).toBeNull()
        expect((await prisma.server.findUniqueOrThrow({ where: { id: serverId } })).welcomeChannelId).toBeNull()
    })

    it('two changes to one server wait for each other: one of two same names, both of two moves', async () => {
        const { serverId, info } = await studyServer()
        const same = await Promise.all(
            ['an', 'chi'].map((who) =>
                send(who as Who, 'post', `${serverId}/channels`, { type: 'text', name: 'On tap', category_id: info })
            )
        )
        expect(same.map((r) => r.status).sort()).toEqual([201, 422])

        const chi = await view('chi', serverId)
        const id = (name: string) => chi.channels.find((c) => c.name === name)!.id
        const moves = await Promise.all([
            send('an', 'patch', `${serverId}/channels/order`, {
                kind: 'channel',
                id: id('viec-nhom'),
                category_id: info,
                after_id: null
            }),
            send('chi', 'patch', `${serverId}/channels/order`, {
                kind: 'channel',
                id: id('on-tap'),
                category_id: null,
                after_id: null
            })
        ])
        expect(moves.map((r) => r.status)).toEqual([200, 200])
        const after = layout(await view('an', serverId))
        expect(after[0]).toEqual(['-', ['on-tap']])
        expect((after[1][1] as string[])[0]).toBe('viec-nhom')
    })
})
