import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { Permission } from '@/modules/permissions'
import { MAX_OPEN_TASKS } from '@/modules/tasks/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Task Boards through the whole app (REQ-TASK-01 to 03, SRS 5.1, D-96,
 * D-97, D-188, D-189, D-191): the switch in the channel settings, who may do
 * what, the limit of 500 tasks not done held under concurrent requests, the
 * search without accents, the done group a page at a time, the history, and
 * what the channel hears.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Task Boards (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-tasks-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'chi' | 'dung' | 'lan'

    let app: NestExpressApplication
    let prisma: PrismaService
    let socketUrl: string
    const users = {} as Record<Who, { token: string; id: string }>
    const opened: Socket[] = []
    let serverId: string
    let boardId: string
    let secretId: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]
    const ids = (res: request.Response) => (res.body.data.items as { id: string }[]).map((task) => task.id)

    const setBoard = (who: Who, channelId: string, on: boolean) =>
        as(who, api().patch(`/api/v1/servers/${serverId}/channels/${channelId}`)).send({ task_board_enabled: on })
    const create = (who: Who, channelId: string, body: object) =>
        as(who, api().post(`/api/v1/channels/${channelId}/tasks`))
            .set('Idempotency-Key', randomUUID())
            .send(body)
    const board = (who: Who, channelId: string, query = '') =>
        as(who, api().get(`/api/v1/channels/${channelId}/tasks${query}`))
    const update = (who: Who, taskId: string, body: object) =>
        as(who, api().patch(`/api/v1/tasks/${taskId}`)).send(body)
    const assign = (who: Who, taskId: string, userIds: string[]) =>
        as(who, api().post(`/api/v1/tasks/${taskId}/assignees`)).send({ user_ids: userIds })
    const unassign = (who: Who, taskId: string, userId: string) =>
        as(who, api().delete(`/api/v1/tasks/${taskId}/assignees/${userId}`))
    const remove = (who: Who, taskId: string) => as(who, api().delete(`/api/v1/tasks/${taskId}`))
    const history = (who: Who, taskId: string) => as(who, api().get(`/api/v1/tasks/${taskId}/history`))

    const inHours = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString()

    /** A task of An's made through the API. */
    const make = async (title: string, extra: object = {}): Promise<string> => {
        const res = await create('an', boardId, { title, due_at: inHours(48), ...extra })
        expect(res.status).toBe(201)
        return res.body.data.id
    }

    /** `count` open tasks straight into the database: these tests need more than a request each allows. */
    async function seedOpen(channelId: string, count: number) {
        await prisma.task.createMany({
            data: Array.from({ length: count }, (_, i) => ({
                serverId,
                channelId,
                creatorId: users.an.id,
                title: `Việc ${i + 1}`,
                titleSearch: `viec ${i + 1}`
            }))
        })
    }

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

    beforeAll(async () => {
        app = await bootApp()
        await app.listen(0)
        socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi', 'dung', 'lan'] as Who[]) await signUp(who)

        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Nhóm đồ án Mobile', template: 'standard' })
        serverId = created.body.data.id
        const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        for (const who of ['binh', 'chi', 'dung'] as Who[]) {
            await as(who, api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
        }
        const channel = async (name: string, isPrivate = false) => {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name, is_private: isPrivate, view_role_ids: [] })
            return res.body.data.id as string
        }
        boardId = await channel('viec-nhom')
        secretId = await channel('ban-can-su', true)

        // Chi manages tasks (Quản lý việc); Dũng is timed out for a day.
        const role = await as('an', api().post(`/api/v1/servers/${serverId}/roles`))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Quản lý việc' })
        const roleId: string = role.body.data.role_id
        await as('an', api().patch(`/api/v1/servers/${serverId}/roles/${roleId}`)).send({
            permissions: Permission.MANAGE_TASKS.toString()
        })
        await as('an', api().put(`/api/v1/servers/${serverId}/roles/${roleId}/members`)).send({
            user_ids: [users.chi.id]
        })
        await as('an', api().patch(`/api/v1/servers/${serverId}/members/${users.dung.id}`)).send({
            timeout_seconds: 86_400,
            reason: 'Thử'
        })
        expect((await setBoard('an', boardId, true)).status).toBe(200)
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

    describe('the switch (REQ-TASK-01, D-189)', () => {
        it('needs MANAGE_CHANNELS, and a board that is off hides its tasks until it is on again', async () => {
            const kept = await make('Giữ qua lúc tắt')
            expect(outcome(await setBoard('binh', boardId, false))).toEqual([403, 'FORBIDDEN_ERROR'])

            expect((await setBoard('an', boardId, false)).status).toBe(200)
            const servers = await as('binh', api().get(`/api/v1/servers/${serverId}`))
            const seen = servers.body.data.channels.find((c: { id: string }) => c.id === boardId)
            expect(seen.task_board_enabled).toBe(false)
            for (const res of [
                await board('binh', boardId),
                await create('an', boardId, { title: 'Không được' }),
                await update('an', kept, { status: 'done' })
            ]) {
                expect(outcome(res)).toEqual([403, 'FORBIDDEN_ERROR'])
                expect(res.body.data).toMatchObject({ reason: 'task_board_disabled' })
            }

            expect((await setBoard('an', boardId, true)).status).toBe(200)
            expect(ids(await board('binh', boardId))).toContain(kept)
            await remove('an', kept)
        })
    })

    describe('who may do what (REQ-TASK-02, D-188)', () => {
        it('lets a member make a task for people who view the channel, not for anyone else', async () => {
            const res = await create('binh', boardId, {
                title: '  Nộp báo cáo giữa kỳ ',
                due_at: inHours(30),
                assignee_ids: [users.binh.id, users.chi.id]
            })
            expect(res.status).toBe(201)
            expect(res.body.data).toMatchObject({
                title: 'Nộp báo cáo giữa kỳ',
                status: 'todo',
                creator: { id: users.binh.id },
                assignees: [{ id: users.binh.id }, { id: users.chi.id }].sort((a, b) => a.id.localeCompare(b.id))
            })

            const refused = await create('binh', boardId, { title: 'X', assignee_ids: [users.lan.id] })
            expect(outcome(refused)).toEqual([400, 'INVALID_TASK_ASSIGNEE'])
            expect(refused.body.data).toMatchObject({ user_ids: [users.lan.id] })
            expect((await setBoard('an', secretId, true)).status).toBe(200)
            expect(outcome(await create('an', secretId, { title: 'X', assignee_ids: [users.binh.id] }))).toEqual([
                400,
                'INVALID_TASK_ASSIGNEE'
            ])
            expect(outcome(await board('binh', secretId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await create('lan', boardId, { title: 'X' }))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('refuses a field sent as null that cannot be empty, and a due date without its offset', async () => {
            const id = await make('Kiểm tra dữ liệu')
            for (const body of [{ title: null }, { description: null }, { status: null }]) {
                expect(outcome(await update('an', id, body))).toEqual([422, 'VALIDATION_ERROR'])
            }
            expect((await update('an', id, { due_at: null })).body.data.due_at).toBeNull()
            expect(outcome(await create('an', boardId, { title: 'X', due_at: '2030-01-01T10:00:00' }))).toEqual([
                422,
                'VALIDATION_ERROR'
            ])
            expect(outcome(await create('an', boardId, { title: 'X', due_at: '2030-01-01' }))).toEqual([
                422,
                'VALIDATION_ERROR'
            ])
            const offset = await create('an', boardId, { title: 'Giờ VN', due_at: '2030-01-01T10:00:00+07:00' })
            expect(offset.body.data.due_at).toBe('2030-01-01T03:00:00.000Z')
        })

        it('refuses a due date already passed, but keeps an old one when the title changes (D-96)', async () => {
            expect(outcome(await create('an', boardId, { title: 'Muộn', due_at: inHours(-1) }))).toEqual([
                400,
                'INVALID_TASK_DUE_DATE'
            ])
            const id = await make('Thiết kế màn hình đăng nhập')
            const past = new Date(Date.now() - 3 * 86_400_000)
            await prisma.task.update({ where: { id }, data: { dueAt: past, status: 'done', completedAt: new Date() } })

            const res = await update('an', id, { title: 'Thiết kế màn đăng nhập', due_at: past.toISOString() })
            expect(res.status).toBe(200)
            expect(res.body.data).toMatchObject({ title: 'Thiết kế màn đăng nhập', due_at: past.toISOString() })
            expect(outcome(await update('an', id, { due_at: inHours(-2) }))).toEqual([400, 'INVALID_TASK_DUE_DATE'])
        })

        it('lets an assignee change the status and take themselves off, not edit or take off another', async () => {
            const id = await make('Sửa lỗi đăng nhập', { assignee_ids: [users.binh.id, users.chi.id] })

            expect((await update('binh', id, { status: 'doing' })).body.data.status).toBe('doing')
            expect(outcome(await update('binh', id, { title: 'Khác' }))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect(outcome(await unassign('binh', id, users.chi.id))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect(outcome(await remove('binh', id))).toEqual([403, 'FORBIDDEN_ERROR'])

            const left = await unassign('binh', id, users.binh.id)
            expect(left.status).toBe(200)
            expect(left.body.data.assignees.map((a: { id: string }) => a.id)).toEqual([users.chi.id])
            expect((await assign('binh', id, [users.binh.id])).status).toBe(200)
        })

        it('lets MANAGE_TASKS edit, take people off and delete a task made by another', async () => {
            const id = await make('Viết tài liệu API', { assignee_ids: [users.binh.id] })
            expect((await update('chi', id, { title: 'Viết tài liệu API v2' })).status).toBe(200)
            expect((await unassign('chi', id, users.binh.id)).body.data.assignees).toEqual([])
            expect((await remove('chi', id)).status).toBe(200)
            expect(outcome(await as('an', api().get(`/api/v1/tasks/${id}`)))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('leaves a member timed out viewing only (D-188)', async () => {
            const id = await make('Ôn chương 4', { assignee_ids: [users.dung.id] })
            expect((await board('dung', boardId)).status).toBe(200)
            for (const res of [
                await create('dung', boardId, { title: 'X' }),
                await update('dung', id, { status: 'done' }),
                await unassign('dung', id, users.dung.id)
            ]) {
                expect(outcome(res)).toEqual([403, 'MEMBER_TIMED_OUT'])
                expect(res.body.data.timeout_until).toEqual(expect.any(String))
            }
        })
    })

    describe('the limit of 500 tasks not done (REQ-TASK-01)', () => {
        it('lets only one of two requests at once make the 500th, and done tasks free room', async () => {
            const channelRes = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name: 'day-du', is_private: false, view_role_ids: [] })
            const fullId: string = channelRes.body.data.id
            await setBoard('an', fullId, true)
            await seedOpen(fullId, MAX_OPEN_TASKS - 1)

            const both = await Promise.all([
                create('an', fullId, { title: 'Một' }),
                create('binh', fullId, { title: 'Hai' })
            ])
            expect(both.map((res) => res.status).sort()).toEqual([201, 409])
            expect(both.find((res) => res.status === 409)!.body.meta.type).toBe('MAX_OPEN_TASKS_REACHED')

            const made = both.find((res) => res.status === 201)!.body.data.id
            expect((await update('an', made, { status: 'done' })).status).toBe(200)
            expect((await create('binh', fullId, { title: 'Hai' })).status).toBe(201)

            // Full again: reopening the done one would make a 501st (spec 05 › Edge case).
            expect(outcome(await update('an', made, { status: 'todo' }))).toEqual([409, 'MAX_OPEN_TASKS_REACHED'])
            expect((await as('an', api().get(`/api/v1/tasks/${made}`))).body.data.status).toBe('done')
        })
    })

    describe('reading a board (S-TASK-01, D-97, D-186)', () => {
        let searchId: string

        beforeAll(async () => {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name: 'tim-viec', is_private: false, view_role_ids: [] })
            searchId = res.body.data.id
            await setBoard('an', searchId, true)
        })

        it('orders tasks not done by due date, none last, ties by the order made, and counts the done', async () => {
            const soon = await create('an', searchId, { title: 'Sớm', due_at: inHours(5) })
            const none = await create('an', searchId, { title: 'Không hạn' })
            const late = await create('an', searchId, { title: 'Muộn', due_at: inHours(50) })
            const tie = await create('an', searchId, { title: 'Cùng hạn', due_at: soon.body.data.due_at })
            const done = await create('an', searchId, { title: 'Đã xong' })
            await update('an', done.body.data.id, { status: 'done' })

            const res = await board('binh', searchId)
            expect(ids(res)).toEqual([soon, tie, late, none].map((r) => r.body.data.id))
            expect(res.body.data).toMatchObject({ done_count: 1, has_more: false })
        })

        it('finds titles whatever the accents and case, the words as typed (D-97)', async () => {
            const outline = await create('an', searchId, { title: 'Tổng hợp ĐỀ CƯƠNG chương 1–3' })
            const percent = await create('an', searchId, { title: 'Xong 50% đề' })
            await create('an', searchId, { title: 'Xong 500 đề' })

            expect(ids(await board('binh', searchId, '?q=de%20cuong'))).toEqual([outline.body.data.id])
            expect(ids(await board('binh', searchId, '?q=50%25'))).toEqual([percent.body.data.id])
            expect(ids(await board('binh', searchId, '?q=_'))).toEqual([])
        })

        it('pages the done tasks, the latest done first, and asks to start again after a task reopened', async () => {
            const pageId = (
                await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                    .set('Idempotency-Key', randomUUID())
                    .send({ type: 'text', name: 'xong-nhieu', is_private: false, view_role_ids: [] })
            ).body.data.id as string
            await setBoard('an', pageId, true)
            const base = Date.now() - 86_400_000
            await prisma.task.createMany({
                data: Array.from({ length: 55 }, (_, i) => ({
                    serverId,
                    channelId: pageId,
                    creatorId: users.an.id,
                    title: `Xong ${i}`,
                    titleSearch: `xong ${i}`,
                    status: 'done' as const,
                    completedAt: new Date(base + i * 1000)
                }))
            })

            const first = await board('binh', pageId, '?status=done')
            expect(first.body.data.items).toHaveLength(50)
            expect(first.body.data).toMatchObject({ done_count: null, has_more: true })
            expect(first.body.data.items[0].title).toBe('Xong 54')
            const last = first.body.data.items[49].id as string

            const second = await board('binh', pageId, `?status=done&before=${last}`)
            expect(second.body.data.items.map((t: { title: string }) => t.title)).toEqual([
                'Xong 4',
                'Xong 3',
                'Xong 2',
                'Xong 1',
                'Xong 0'
            ])
            expect(second.body.data.has_more).toBe(false)

            expect((await update('an', last, { status: 'todo' })).status).toBe(200)
            expect(outcome(await board('binh', pageId, `?status=done&before=${last}`))).toEqual([409, 'CONFLICT_ERROR'])
        })
    })

    describe('history and events (REQ-TASK-03, SRS 5.2)', () => {
        it('writes each change by whom, newest first, and tells the channel the task as it is', async () => {
            const chi = await connectAs('chi')
            const created = collect(chi, 'task.created')
            const updated = collect(chi, 'task.updated')
            const deleted = collect(chi, 'task.deleted')

            const id = await make('Cập nhật tiến độ tuần', { assignee_ids: [users.binh.id] })
            await assign('an', id, [users.an.id])
            await update('binh', id, { status: 'done' })
            await update('an', id, { status: 'done' })
            await unassign('binh', id, users.binh.id)

            const res = await history('binh', id)
            expect(res.body.data.total).toBe(6)
            expect(
                res.body.data.items.map(
                    (line: { kind: string; actor: { id: string }; subject: { id: string } | null }) => [
                        line.kind,
                        line.actor.id,
                        line.subject?.id ?? null
                    ]
                )
            ).toEqual([
                ['assignee_removed', users.binh.id, users.binh.id],
                ['status_changed', users.binh.id, null],
                ['assignee_added', users.an.id, users.an.id],
                ['assignee_added', users.an.id, users.binh.id],
                ['due_changed', users.an.id, null],
                ['created', users.an.id, null]
            ])
            expect(res.body.data.items[1]).toMatchObject({ from: 'todo', to: 'done' })

            await remove('an', id)
            expect(await created()).toEqual([expect.objectContaining({ task: expect.objectContaining({ id }) })])
            // A status set again to what it is changes nothing and tells no one.
            expect((await updated()) as { task: { status: string } }[]).toHaveLength(3)
            expect(await deleted()).toEqual([{ task_id: id, channel_id: boardId }])
        })
    })
})
