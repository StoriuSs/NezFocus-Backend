import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { getQueueToken } from '@nestjs/bullmq'
import { CommandBus } from '@nestjs/cqrs'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Queue } from 'bullmq'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { Permission } from '@/modules/permissions'
import { SendTaskReminderCommand } from '@/modules/tasks/application'
import { MAX_OPEN_TASKS } from '@/modules/tasks/domain'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Task Boards through the whole app (REQ-TASK-01 to 03, SRS 5.1, D-96,
 * D-97, D-188, D-189, D-191): the switch in the channel settings, who may do
 * what, the limit of 500 tasks not done held under concurrent requests, the
 * search without accents, the done group a page at a time, the history,
 * what the channel hears, and the people who lose the channel or leave the
 * server (D-194, D-195), and the To-do page that gathers one's tasks from every
 * server (REQ-TASK-05, D-186); the inbox items of tasks, the due-date
 * reminders and their message in the channel (D-95, D-98, D-200, REQ-TASK-04).
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

    // Last: Bình leaves the server.
    describe('people who lose the channel or leave the server (REQ-TASK-04, D-194, D-195)', () => {
        it('marks who no longer views the channel, and takes off its tasks whoever leaves the server', async () => {
            const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                .set('Idempotency-Key', randomUUID())
                .send({ type: 'text', name: 'nhom-nho', is_private: false, view_role_ids: [] })
            const smallId: string = res.body.data.id
            expect((await setBoard('an', smallId, true)).status).toBe(200)
            const made = await create('an', smallId, {
                title: 'Viết tài liệu API',
                assignee_ids: [users.binh.id, users.chi.id, users.an.id]
            })
            const id: string = made.body.data.id
            expect(made.body.data.assignees.map((person: { views_channel: boolean }) => person.views_channel)).toEqual([
                true,
                true,
                true
            ])
            const byBinh = await create('binh', boardId, { title: 'Việc của Bình' })
            expect(byBinh.body.data.creator).toMatchObject({ id: users.binh.id, left_server: false })

            // Private, no role may view it: only An, the owner, still does.
            await as('an', api().patch(`/api/v1/servers/${serverId}/channels/${smallId}`)).send({ is_private: true })
            const lost = await as('an', api().get(`/api/v1/tasks/${id}`))
            // Given at once: their order is by id.
            expect(
                Object.fromEntries(
                    lost.body.data.assignees.map((person: { id: string; views_channel: boolean }) => [
                        person.id,
                        person.views_channel
                    ])
                )
            ).toEqual({ [users.binh.id]: false, [users.chi.id]: false, [users.an.id]: true })

            const an = await connectAs('an')
            const updated = collect(an, 'task.updated')
            expect((await as('binh', api().delete(`/api/v1/servers/${serverId}/members/me`))).status).toBe(200)

            // The queue takes Bình off soon after the leave answered.
            let people: string[] = []
            for (let tries = 0; tries < 50; tries++) {
                const task = await as('an', api().get(`/api/v1/tasks/${id}`))
                people = task.body.data.assignees.map((person: { id: string }) => person.id)
                if (!people.includes(users.binh.id)) break
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
            expect(people.sort()).toEqual([users.chi.id, users.an.id].sort())
            const lines = await history('an', id)
            expect(lines.body.data.items[0]).toMatchObject({
                kind: 'assignee_removed',
                actor: null,
                subject: { id: users.binh.id }
            })
            // Each task Bình was on is told: this one, and those of the earlier tests.
            expect((await updated()) as { task: { id: string } }[]).toEqual(
                expect.arrayContaining([expect.objectContaining({ task: expect.objectContaining({ id }) })])
            )
            const left = await as('an', api().get(`/api/v1/tasks/${byBinh.body.data.id}`))
            expect(left.body.data.creator).toMatchObject({ id: users.binh.id, left_server: true })
        })
    })

    describe('the To-do page (REQ-TASK-05, D-186)', () => {
        const mine = (query = '') => as('lan', api().get(`/api/v1/me/tasks${query}`))

        it('lists one’s tasks from every server one still views, grouped, counted, filtered and paged', async () => {
            // Lan joins An's server, and makes one of her own ("Ôn thi Giải tích 2").
            const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
                .set('Idempotency-Key', randomUUID())
                .send({ max_age_seconds: null, max_uses: null })
            await as('lan', api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
            const own = await as('lan', api().post('/api/v1/servers'))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Ôn thi Giải tích 2', template: 'standard' })
            const ownId: string = own.body.data.id
            const textChannel = async (who: Who, server: string, name: string) => {
                const res = await as(who, api().post(`/api/v1/servers/${server}/channels`))
                    .set('Idempotency-Key', randomUUID())
                    .send({ type: 'text', name, is_private: false, view_role_ids: [] })
                await as(who, api().patch(`/api/v1/servers/${server}/channels/${res.body.data.id}`)).send({
                    task_board_enabled: true
                })
                return res.body.data.id as string
            }
            const ownBoard = await textChannel('lan', ownId, 'viec-on-thi')
            const hidden = await textChannel('an', serverId, 'sap-rieng-tu')

            const given = await create('an', boardId, { title: 'Sửa lỗi đăng nhập', assignee_ids: [users.lan.id] })
            const later = await create('an', boardId, {
                title: 'Chuẩn bị demo cuối kỳ',
                due_at: inHours(30 * 24),
                assignee_ids: [users.lan.id]
            })
            const noDue = await create('lan', ownBoard, { title: 'Làm slide thuyết trình' })
            const done = await create('lan', ownBoard, { title: 'Đọc tài liệu chương 5' })
            await update('lan', done.body.data.id, { status: 'done' })
            await create('an', boardId, { title: 'Việc của người khác', assignee_ids: [users.chi.id] })
            await create('an', hidden, { title: 'Sắp riêng tư', assignee_ids: [users.lan.id] })
            await as('an', api().patch(`/api/v1/servers/${serverId}/channels/${hidden}`)).send({ is_private: true })
            // Past due: the API never sets a date already passed (D-96).
            await prisma.task.update({
                where: { id: given.body.data.id },
                data: { dueAt: new Date(Date.now() - 3600_000) }
            })

            const all = await mine()
            expect(all.status).toBe(200)
            expect(all.body.data.items.map((task: { id: string; group: string }) => [task.id, task.group])).toEqual([
                [given.body.data.id, 'overdue'],
                [later.body.data.id, 'later'],
                [noDue.body.data.id, 'no_due']
            ])
            expect(all.body.data).toMatchObject({ done_count: 1, due_count: 1, has_more: false })

            expect(ids(await mine(`?server=${ownId}`))).toEqual([noDue.body.data.id])
            expect(ids(await mine(`?server=${randomUUID()}`))).toEqual([])
            expect(ids(await mine('?q=SUA%20loi'))).toEqual([given.body.data.id])

            const donePage = await mine('?status=done')
            expect(donePage.body.data).toMatchObject({ done_count: null, due_count: null, has_more: false })
            expect(donePage.body.data.items.map((task: { id: string; group: null }) => [task.id, task.group])).toEqual([
                [done.body.data.id, null]
            ])

            // 52 more done tasks of Lan's, and 3 done ones in the same channel given to An only, among them.
            const base = Date.now() - 86_400_000
            await prisma.task.createMany({
                data: Array.from({ length: 52 }, (_, i) => ({
                    serverId: ownId,
                    channelId: ownBoard,
                    creatorId: users.lan.id,
                    title: `Xong ${i}`,
                    titleSearch: `xong ${i}`,
                    status: 'done' as const,
                    completedAt: new Date(base + i * 1000)
                }))
            })
            for (const i of [0, 1, 2]) {
                await prisma.task.create({
                    data: {
                        serverId: ownId,
                        channelId: ownBoard,
                        creatorId: users.lan.id,
                        title: `Của An ${i}`,
                        titleSearch: `cua an ${i}`,
                        status: 'done',
                        completedAt: new Date(base + i * 1000 + 500),
                        assignees: { create: { userId: users.an.id } }
                    }
                })
            }
            const first = await mine('?status=done')
            expect(first.body.data.items).toHaveLength(50)
            expect(first.body.data.has_more).toBe(true)
            const second = await mine(`?status=done&before=${first.body.data.items[49].id}`)
            const titles = (res: request.Response) => res.body.data.items.map((task: { title: string }) => task.title)
            expect(titles(second)).toEqual(['Xong 2', 'Xong 1', 'Xong 0'])
            expect([...titles(first), ...titles(second)].filter((title: string) => title.startsWith('Của An'))).toEqual(
                []
            )
            expect((await mine()).body.data.done_count).toBe(53)

            // A board turned off hides its tasks; a task one pages after that is gone from the list asks to start again.
            await as('lan', api().patch(`/api/v1/servers/${ownId}/channels/${ownBoard}`)).send({
                task_board_enabled: false
            })
            expect(ids(await mine())).toEqual([given.body.data.id, later.body.data.id])
            expect(outcome(await mine(`?status=done&before=${done.body.data.id}`))).toEqual([409, 'CONFLICT_ERROR'])
        })
    })

    // Bình left the server in a test above: Chi and Dũng are the people here.
    describe('inbox items and reminders of tasks (D-95, D-98, D-200, REQ-TASK-04)', () => {
        type Item = { id: string; type: string; task_id: string | null; actor: { id: string } | null; task: unknown }
        const inbox = async (who: Who): Promise<Item[]> =>
            (await as(who, api().get('/api/v1/me/notifications?limit=100'))).body.data.items
        /** The items are written after the write is saved: wait until `ready` holds. */
        async function inboxUntil(who: Who, ready: (items: Item[]) => boolean): Promise<Item[]> {
            let items: Item[] = []
            for (let tries = 0; tries < 50; tries++) {
                items = await inbox(who)
                if (ready(items)) break
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
            return items
        }
        const ofTask = (items: Item[], taskId: string) => items.filter((item) => item.task_id === taskId)
        const queue = () => app.get<Queue>(getQueueToken(QUEUES.TASKS))
        /** The reminders waiting for a task; set after the write answered, so read until they settle. */
        async function jobIdsUntil(taskId: string, count: number): Promise<string[]> {
            let found: string[] = []
            for (let tries = 0; tries < 30; tries++) {
                // A job removed while it is listed comes back empty.
                found = (await queue().getJobs(['delayed', 'waiting']))
                    .map((job) => job?.id ?? '')
                    .filter((jobId) => jobId.startsWith(`task-${taskId}-`))
                    .sort()
                if (found.length === count) break
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
            return found
        }

        it('gives the people put on a task by someone else an item that keeps its title and due date, not the one who did it', async () => {
            const due = inHours(30)
            const made = await create('an', boardId, {
                title: 'Chuẩn bị demo cuối kỳ',
                due_at: due,
                assignee_ids: [users.chi.id, users.an.id]
            })
            const id: string = made.body.data.id
            const items = ofTask(await inboxUntil('chi', (all) => ofTask(all, id).length > 0), id)
            expect(items).toEqual([
                expect.objectContaining({
                    type: 'task_assigned',
                    actor: expect.objectContaining({ id: users.an.id }),
                    task: { title: 'Chuẩn bị demo cuối kỳ', due_at: due, reminder: null, unassigned_by: null }
                })
            ])
            // Taking a task on oneself makes none; a later title leaves the item's words as they were (D-98).
            const byChi = await create('chi', boardId, { title: 'Việc của Chi' })
            expect((await assign('an', byChi.body.data.id, [users.an.id])).status).toBe(200)
            expect((await update('an', id, { title: 'Demo cuối kỳ' })).status).toBe(200)
            await new Promise((resolve) => setTimeout(resolve, 300))
            expect(ofTask(await inbox('an'), id)).toEqual([])
            expect(ofTask(await inbox('an'), byChi.body.data.id)).toEqual([])
            expect(ofTask(await inbox('chi'), id)[0]!.task).toMatchObject({ title: 'Chuẩn bị demo cuối kỳ' })
        })

        it('tells the creator when the last person on it takes themselves off, not when the creator takes them off', async () => {
            const made = await create('an', boardId, { title: 'Làm slide thuyết trình', assignee_ids: [users.chi.id] })
            const id: string = made.body.data.id
            expect((await unassign('chi', id, users.chi.id)).status).toBe(200)
            const items = ofTask(await inboxUntil('an', (all) => ofTask(all, id).length > 0), id)
            expect(items).toEqual([
                expect.objectContaining({
                    type: 'task_unassigned',
                    actor: expect.objectContaining({ id: users.chi.id }),
                    task: expect.objectContaining({ unassigned_by: 'withdrew' })
                })
            ])

            const other = await create('an', boardId, { title: 'Việc khác', assignee_ids: [users.chi.id] })
            expect((await unassign('an', other.body.data.id, users.chi.id)).status).toBe(200)
            await new Promise((resolve) => setTimeout(resolve, 300))
            expect(ofTask(await inbox('an'), other.body.data.id)).toEqual([])
        })

        it('sets the reminders still ahead, moves them with the due date and drops them when done (ARCHITECTURE 7)', async () => {
            const soon = new Date(Date.now() + 3 * 3600_000)
            soon.setMilliseconds(0)
            const made = await create('an', boardId, { title: 'Nộp báo cáo', due_at: soon.toISOString() })
            const id: string = made.body.data.id
            // 3 hours out: only the 2-hour mark is still ahead (D-95).
            expect(await jobIdsUntil(id, 1)).toEqual([`task-${id}-2h-${soon.getTime()}`])

            const later = new Date(soon.getTime() + 48 * 3600_000)
            await update('an', id, { due_at: later.toISOString() })
            expect(await jobIdsUntil(id, 2)).toEqual([
                `task-${id}-24h-${later.getTime()}`,
                `task-${id}-2h-${later.getTime()}`
            ])

            await update('an', id, { status: 'done' })
            expect(await jobIdsUntil(id, 0)).toEqual([])
            await update('an', id, { status: 'todo' })
            expect(await jobIdsUntil(id, 2)).toHaveLength(2)
            await remove('an', id)
            expect(await jobIdsUntil(id, 0)).toEqual([])
        })

        it('reminds the people on it in their inbox once per mark, and in the channel naming them', async () => {
            const due = new Date(Date.now() + 3 * 3600_000)
            due.setMilliseconds(0)
            const made = await create('an', boardId, {
                title: 'Ôn chương 4',
                due_at: due.toISOString(),
                assignee_ids: [users.chi.id, users.dung.id]
            })
            const id: string = made.body.data.id
            const remind = () => app.get(CommandBus).execute(new SendTaskReminderCommand(id, '2h', due))

            await expect(remind()).resolves.toBe(true)
            // Run again, as a job retried after the message failed: no second item.
            await expect(remind()).resolves.toBe(true)
            for (const who of ['chi', 'dung'] as Who[]) {
                const reminders = ofTask(await inbox(who), id).filter((item) => item.type === 'task_reminder')
                expect(reminders).toEqual([
                    expect.objectContaining({
                        actor: null,
                        task: { title: 'Ôn chương 4', due_at: due.toISOString(), reminder: '2h', unassigned_by: null }
                    })
                ])
            }
            const page = await as('an', api().get(`/api/v1/channels/${boardId}/messages`))
            const said = (
                page.body.data.items as { system_event: string | null; system_data: { task_id?: string } | null }[]
            ).filter((message) => message.system_event === 'task_due' && message.system_data?.task_id === id)
            // Said once for the two runs.
            expect(said).toHaveLength(1)
            // Given at once: their order is by id.
            const named = [users.chi.id, users.dung.id].sort()
            expect(said[0]).toMatchObject({
                type: 'system',
                author: null,
                system_data: {
                    task_id: id,
                    title: 'Ôn chương 4',
                    reminder: '2h',
                    due_at: due.toISOString(),
                    user_ids: named
                },
                system_users: named.map((userId) => ({ id: userId }))
            })

            // Done meanwhile: the job reads it again and sends nothing.
            await update('an', id, { status: 'done' })
            await expect(remind()).resolves.toBe(false)
        })

        it('tells everyone who had an item of a deleted task, with the task and their new count (D-200)', async () => {
            const made = await create('an', boardId, { title: 'Sẽ bị xóa', assignee_ids: [users.chi.id] })
            const id: string = made.body.data.id
            await inboxUntil('chi', (all) => ofTask(all, id).length > 0)
            const before = (await as('chi', api().get('/api/v1/me/notifications'))).body.data.unread_count as number

            const chi = await connectAs('chi')
            const deleted = collect(chi, 'notification.deleted')
            expect((await remove('an', id)).status).toBe(200)

            expect(ofTask(await inbox('chi'), id)).toEqual([])
            expect(await deleted()).toEqual([{ ids: [], unread_count: before - 1, task_id: id }])
        })

        it('tells someone taken off a task before it is deleted too: their item stayed (D-98, D-200)', async () => {
            const made = await create('an', boardId, { title: 'Gỡ rồi xóa', assignee_ids: [users.chi.id] })
            const id: string = made.body.data.id
            await inboxUntil('chi', (all) => ofTask(all, id).length > 0)
            expect((await unassign('an', id, users.chi.id)).status).toBe(200)
            // Taken off, the item keeps its words (D-98).
            expect(ofTask(await inbox('chi'), id)).toHaveLength(1)

            const chi = await connectAs('chi')
            const deleted = collect(chi, 'notification.deleted')
            expect((await remove('an', id)).status).toBe(200)

            expect(ofTask(await inbox('chi'), id)).toEqual([])
            expect(await deleted()).toEqual([expect.objectContaining({ ids: [], task_id: id })])
        })
    })

    describe('deleting a task while its channel is deleted', () => {
        it('waits for the channel before it holds the task, so the two deletes never wait on each other in turn', async () => {
            const created = await create('an', boardId, { title: 'Xóa cùng lúc với kênh' })
            const id: string = created.body.data.id
            // A channel delete holds its row, then the inbox items and tasks of
            // the channel (cascade); here only the row, until let go.
            let letGo!: () => void
            const released = new Promise<void>((resolve) => (letGo = resolve))
            let holding!: () => void
            const held = new Promise<void>((resolve) => (holding = resolve))
            const channelDelete = prisma.$transaction(
                async (tx) => {
                    await tx.$queryRaw`SELECT 1 FROM "Channel" WHERE "id" = ${boardId} FOR UPDATE`
                    holding()
                    await released
                },
                { timeout: 30_000 }
            )
            await held
            const deleting = remove('an', id).then((res) => res.status)
            // Until the task delete waits on the channel row (it never does
            // when it locks the task first: then it is done or past it).
            for (let tries = 0; tries < 100; tries++) {
                const [waiting] = await prisma.$queryRaw<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM pg_stat_activity
                    WHERE wait_event_type = 'Lock' AND query LIKE '%FOR KEY SHARE OF c%'
                `
                if (waiting!.n > 0) break
                await new Promise((resolve) => setTimeout(resolve, 50))
            }

            // The task is still free for the channel delete to take.
            const free = await prisma.$queryRaw<{ id: string }[]>`
                SELECT "id" FROM "Task" WHERE "id" = ${id} FOR UPDATE NOWAIT
            `.catch(() => 'held by the task delete')
            letGo()
            await channelDelete
            expect(free).toEqual([{ id }])
            expect(await deleting).toBe(200)
        })
    })

    describe('constraints of the database (20261117000000_tasks_notifications)', () => {
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
        let otherServerId: string
        let otherChannelId: string

        /** A task of An's written straight to the table, in the board unless told otherwise. */
        const task = (shape: { serverId?: string; channelId?: string; status?: 'todo' | 'done'; completedAt?: Date }) =>
            prisma.task
                .create({
                    data: {
                        serverId,
                        channelId: boardId,
                        creatorId: users.an.id,
                        title: 'a',
                        titleSearch: 'a',
                        ...shape
                    },
                    select: { id: true }
                })
                .then((row) => row.id)
        /** An item of Bình's written straight to the table. */
        const item = (shape: Record<string, unknown>) =>
            prisma.notification.create({
                data: { userId: users.binh.id, serverId, type: 'mention', ...shape } as never,
                select: { id: true }
            })
        const message = (channelId: string) =>
            prisma.message
                .create({ data: { channelId, authorId: users.an.id, nonce: randomUUID() }, select: { id: true } })
                .then((row) => row.id)

        beforeAll(async () => {
            // Lan's own server, for the links that cross servers.
            const created = await as('lan', api().post('/api/v1/servers'))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Server của Lan', template: 'standard' })
            otherServerId = created.body.data.id
            const channel = await prisma.channel.findFirstOrThrow({
                where: { serverId: otherServerId, type: 'text' },
                select: { id: true }
            })
            otherChannelId = channel.id
        })

        it('refuses a done task without the time it was done, and an open one with it', async () => {
            expect(await refusedBy(task({ status: 'done' }))).toBe('Task_completed_check')
            expect(await refusedBy(task({ status: 'todo', completedAt: new Date() }))).toBe('Task_completed_check')
        })

        it('refuses a task naming a channel of another server', async () => {
            expect(await refusedBy(task({ serverId: otherServerId }))).toBe('Task_channelId_serverId_fkey')
            expect(await refusedBy(task({ channelId: otherChannelId }))).toBe('Task_channelId_serverId_fkey')
        })

        it('refuses an item without the links of its kind, or a moderation item that names who did it', async () => {
            const messageId = await message(boardId)
            const taskId = await task({})
            for (const wrong of [
                { type: 'mention', channelId: boardId },
                { type: 'reply', channelId: boardId, messageId, taskId },
                { type: 'task_assigned', channelId: boardId },
                { type: 'task_reminder', channelId: boardId, taskId, messageId },
                { type: 'owner_transferred', channelId: boardId },
                { type: 'moderation', actorId: users.an.id },
                { type: 'moderation', serverId: null }
            ]) {
                expect(await refusedBy(item(wrong))).toBe('Notification_links_check')
            }
        })

        it('refuses an item naming a task or a message of another channel', async () => {
            const taskId = await task({})
            const messageId = await message(boardId)
            expect(await refusedBy(item({ type: 'task_assigned', channelId: secretId, taskId }))).toBe(
                'Notification_channelId_taskId_fkey'
            )
            expect(await refusedBy(item({ type: 'mention', channelId: secretId, messageId }))).toBe(
                'Notification_channelId_messageId_fkey'
            )
        })

        it('refuses a second item of one message for one person, mention or reply', async () => {
            const messageId = await message(boardId)
            expect(await refusedBy(item({ type: 'mention', channelId: boardId, messageId }))).toBe('written')
            expect(await refusedBy(item({ type: 'reply', channelId: boardId, messageId }))).toBe(
                'Notification_userId_messageId_key'
            )
        })

        it('takes away the items of a deleted task, and the moderation items of a server deleted for good', async () => {
            const taskId = await task({})
            const ofTask = await item({ type: 'task_assigned', channelId: boardId, taskId })
            const moderation = await item({ type: 'moderation', serverId: otherServerId })
            await prisma.task.delete({ where: { id: taskId } })
            await prisma.server.delete({ where: { id: otherServerId } })
            const left = await prisma.notification.count({ where: { id: { in: [ofTask.id, moderation.id] } } })
            expect(left).toBe(0)
        })
    })
})
