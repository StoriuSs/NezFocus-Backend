import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { Permission } from '@/modules/permissions'
import { rolePositionsValid } from '@/modules/servers/domain'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Roles through the whole app (REQ-ROLE-01, ROLE-02, ROLE-05, D-152, D-153,
 * M1 "xong khi"): An makes a role and gives it to Bình, who then sees the
 * private channel and stops seeing it when it is taken back; the hierarchy
 * and the permissions one may hand out; a reorder from a stale list; roles
 * made at once keeping their positions 1…n; and the member list.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Roles over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-roles-${randomUUID().slice(0, 8)}`

    type Who = 'an' | 'binh' | 'chi' | 'phong'
    let app: NestExpressApplication
    let prisma: PrismaService
    const users: Record<Who, { token: string; id: string; username: string }> = {} as never

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]
    const url = (serverId: string, path = '') => `/api/v1/servers/${serverId}${path}`

    const createRole = (who: Who, serverId: string, name: string) =>
        as(who, api().post(url(serverId, '/roles')))
            .set('Idempotency-Key', randomUUID())
            .send({ name })
    const updateRole = (who: Who, serverId: string, roleId: string, body: object) =>
        as(who, api().patch(url(serverId, `/roles/${roleId}`))).send(body)
    const grant = (who: Who, serverId: string, roleId: string, userIds: string[]) =>
        as(who, api().put(url(serverId, `/roles/${roleId}/members`))).send({ user_ids: userIds })
    const revoke = (who: Who, serverId: string, roleId: string, userId: string) =>
        as(who, api().delete(url(serverId, `/members/${userId}/roles/${roleId}`)))
    const listRoles = (who: Who, serverId: string) => as(who, api().get(url(serverId, '/roles')))
    const visibleChannels = async (who: Who, serverId: string): Promise<string[]> => {
        const res = await as(who, api().get('/api/v1/servers'))
        const server = res.body.data.servers.find((s: { id: string }) => s.id === serverId)
        return server.channels.map((c: { name: string }) => c.name)
    }
    const positions = async (serverId: string) =>
        prisma.role.findMany({
            where: { serverId },
            select: { id: true, name: true, position: true, isEveryone: true }
        })

    async function signUp(who: Who, displayName: string) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        const username = await completeAccount(post, accessToken, 'Harbour-Lantern-42')
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        await prisma.user.update({ where: { id: me.body.data.id }, data: { displayName } })
        users[who] = { token: accessToken, id: me.body.data.id, username }
    }

    /** An's Study Server, `tai-lieu` private to Trưởng nhóm, with Bình and Chi in it through a link. */
    async function studyServer() {
        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'study' })
        const serverId: string = created.body.data.id
        const tai = await prisma.channel.findFirstOrThrow({ where: { serverId, name: 'tai-lieu' } })
        const lead = await prisma.role.findFirstOrThrow({ where: { serverId, name: 'Trưởng nhóm' } })
        await prisma.channel.update({ where: { id: tai.id }, data: { isPrivate: true } })
        await prisma.channelViewRole.create({ data: { channelId: tai.id, roleId: lead.id, serverId } })
        const link = await as('an', api().post(url(serverId, '/invites')))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        for (const who of ['binh', 'chi'] as const) {
            expect((await as(who, api().post(`/api/v1/invites/${link.body.data.code}/accept`))).status).toBe(200)
        }
        return { serverId, leadId: lead.id }
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        await signUp('an', 'An Nguyễn')
        await signUp('binh', 'Bình Trần')
        await signUp('chi', 'Chi Lê')
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

    it('gives a role, which shows its private channel at once, and takes it back the same way', async () => {
        const { serverId, leadId } = await studyServer()
        expect(await visibleChannels('binh', serverId)).not.toContain('tai-lieu')

        // All or none (D-153): someone outside the server spoils the whole request.
        expect(outcome(await grant('an', serverId, leadId, [users.binh.id, users.phong.id]))).toEqual([
            404,
            'NOT_FOUND_ERROR'
        ])
        expect(await visibleChannels('binh', serverId)).not.toContain('tai-lieu')

        expect((await grant('an', serverId, leadId, [users.binh.id, users.chi.id])).status).toBe(200)
        expect(await visibleChannels('binh', serverId)).toContain('tai-lieu')
        const lead = (await listRoles('an', serverId)).body.data.roles.find((r: { id: string }) => r.id === leadId)
        expect(lead).toMatchObject({ name: 'Trưởng nhóm', member_count: 3, mentionable: false, is_everyone: false })

        expect((await revoke('an', serverId, leadId, users.binh.id)).status).toBe(200)
        expect(await visibleChannels('binh', serverId)).not.toContain('tai-lieu')
        expect(await visibleChannels('chi', serverId)).toContain('tai-lieu')
    })

    it('keeps the Roles page to MANAGE_ROLES and the server to its members', async () => {
        const { serverId } = await studyServer()
        const roles = await listRoles('an', serverId)
        expect(roles.status).toBe(200)
        expect(roles.body.data.roles.map((r: { name: string }) => r.name)).toEqual(['Trưởng nhóm', '@everyone'])
        expect(roles.body.data.roles[1]).toMatchObject({ position: 0, member_count: 3 })
        expect(outcome(await listRoles('binh', serverId))).toEqual([403, 'FORBIDDEN_ERROR'])
        expect(outcome(await listRoles('phong', serverId))).toEqual([404, 'NOT_FOUND_ERROR'])
        expect(outcome(await createRole('binh', serverId, 'Nhóm đề'))).toEqual([403, 'FORBIDDEN_ERROR'])
    })

    it('gives any member the roles they may mention, with how many hold each, and no one outside (D-171)', async () => {
        const { serverId, leadId } = await studyServer()
        const mentionable = (who: Who) => as(who, api().get(url(serverId, '/roles/mentionable')))
        const lead = expect.objectContaining({ id: leadId, name: 'Trưởng nhóm' })
        expect((await mentionable('binh')).body.data.roles).not.toContainEqual(lead)

        expect((await updateRole('an', serverId, leadId, { mentionable: true })).status).toBe(200)
        const seen = (await mentionable('binh')).body.data.roles
        expect(seen).toContainEqual(lead)
        expect(seen.find((role: { id: string }) => role.id === leadId)).toEqual({
            id: leadId,
            name: 'Trưởng nhóm',
            member_count: expect.any(Number)
        })

        // The owner may mention any role (MENTION_EVERYONE), never @everyone's own.
        const all = (await mentionable('an')).body.data.roles.map((role: { name: string }) => role.name)
        expect(all.length).toBeGreaterThanOrEqual(seen.length)
        expect(all).not.toContain('@everyone')
        expect(outcome(await mentionable('phong'))).toEqual([404, 'NOT_FOUND_ERROR'])
    })

    it('holds a manager to roles below theirs and to permissions they hold (REQ-ROLE-02)', async () => {
        const { serverId, leadId } = await studyServer()
        // Trưởng nhóm also manages roles; Bình holds it.
        const leadBits = (await prisma.role.findUniqueOrThrow({ where: { id: leadId } })).permissions
        await updateRole('an', serverId, leadId, { permissions: (leadBits | Permission.MANAGE_ROLES).toString() })
        await grant('an', serverId, leadId, [users.binh.id])

        const made = await createRole('binh', serverId, 'Nhóm đề')
        expect(made.status).toBe(201)
        const roleId: string = made.body.data.role_id
        const names = (await listRoles('binh', serverId)).body.data.roles.map((r: { name: string }) => r.name)
        expect(names).toEqual(['Trưởng nhóm', 'Nhóm đề', '@everyone'])

        // A bit Bình holds, then one he does not.
        const kick = Permission.KICK_MEMBERS.toString()
        expect((await updateRole('binh', serverId, roleId, { permissions: kick })).status).toBe(200)
        const ban = (Permission.KICK_MEMBERS | Permission.BAN_MEMBERS).toString()
        expect(outcome(await updateRole('binh', serverId, roleId, { permissions: ban }))).toEqual([
            403,
            'FORBIDDEN_ERROR'
        ])
        // His own highest role, and An, are out of his reach.
        expect(outcome(await updateRole('binh', serverId, leadId, { name: 'Trưởng nhóm K22' }))).toEqual([
            403,
            'ROLE_HIERARCHY_VIOLATION'
        ])
        expect(outcome(await grant('binh', serverId, roleId, [users.an.id]))).toEqual([403, 'ROLE_HIERARCHY_VIOLATION'])
        expect((await grant('binh', serverId, roleId, [users.chi.id, users.binh.id])).status).toBe(200)

        // Names (REQ-ROLE-01).
        const rule = (res: request.Response) => [res.status, res.body.data?.rule]
        expect(rule(await createRole('an', serverId, 'nhóm đề'))).toEqual([422, 'name_taken'])
        expect(rule(await createRole('an', serverId, '@Here'))).toEqual([422, 'name_reserved'])
        // Null is refused, not taken for "not sent".
        expect((await updateRole('an', serverId, roleId, { permissions: null })).status).toBe(422)
        expect((await updateRole('an', serverId, roleId, { mentionable: null })).status).toBe(422)
        expect(rule(await updateRole('an', serverId, roleId, { permissions: (1n << 9n).toString() }))).toEqual([
            422,
            'unknown_bits'
        ])

        // Deleting closes the gap and takes the role from its members.
        expect((await as('an', api().delete(url(serverId, `/roles/${roleId}`)))).status).toBe(200)
        expect(rolePositionsValid(await positions(serverId))).toBe(true)
        expect(await prisma.memberRole.count({ where: { roleId } })).toBe(0)
    })

    it('refuses an order made from a list that has changed since, and keeps positions 1…n under concurrent changes', async () => {
        const { serverId, leadId } = await studyServer()
        const results = await Promise.all(
            ['Nhóm 1', 'Nhóm 2', 'Nhóm 3', 'Nhóm 4', 'Nhóm 5'].map((name) => createRole('an', serverId, name))
        )
        expect(results.map((res) => res.status)).toEqual([201, 201, 201, 201, 201])
        expect(rolePositionsValid(await positions(serverId))).toBe(true)

        const seen = (await listRoles('an', serverId)).body.data.roles
            .filter((r: { is_everyone: boolean }) => !r.is_everyone)
            .map((r: { id: string }) => r.id) as string[]
        const wanted = [...seen.slice(1), seen[0]!]
        const reorder = (body: object) => as('an', api().patch(url(serverId, '/roles/order'))).send(body)

        expect(outcome(await reorder({ order: wanted, seen_order: [...seen].reverse() }))).toEqual([
            409,
            'CONFLICT_ERROR'
        ])
        expect((await reorder({ order: wanted, seen_order: seen })).status).toBe(200)
        const after = (await positions(serverId)).filter((r) => !r.isEveryone).sort((a, b) => b.position - a.position)
        expect(after.map((r) => r.id)).toEqual(wanted)
        expect(after.at(-1)!.id).toBe(seen[0])
        expect(rolePositionsValid(await positions(serverId))).toBe(true)
        expect(seen).toContain(leadId)
    })

    it('lists the members by name for anyone in the server, found without accents or by role (D-152)', async () => {
        const { serverId, leadId } = await studyServer()
        const members = (who: Who, query: string) => as(who, api().get(url(serverId, `/members${query}`)))

        const all = await members('chi', '')
        expect(all.status).toBe(200)
        expect(all.body.data.items.map((m: { display_name: string }) => m.display_name)).toEqual([
            'An Nguyễn',
            'Bình Trần',
            'Chi Lê'
        ])
        expect(all.body.data.items[0]).toMatchObject({ is_owner: true, role_ids: [leadId] })
        expect(all.body.data.meta).toMatchObject({ total_items: 3, items_per_page: 50, current_page: 1 })

        const found = await members('chi', '?q=binh')
        expect(found.body.data.items.map((m: { user_id: string }) => m.user_id)).toEqual([users.binh.id])
        expect((await members('chi', '?q=TRAN')).body.data.items).toHaveLength(1)
        expect((await members('chi', '?q=%25')).body.data.items).toHaveLength(0)

        const byRole = await members('chi', `?role_id=${leadId}`)
        expect(byRole.body.data.items.map((m: { user_id: string }) => m.user_id)).toEqual([users.an.id])

        const paged = await members('chi', '?limit=10&page=2')
        expect(paged.body.data.items).toHaveLength(0)
        expect((await members('chi', '?limit=20')).status).toBe(422)
        expect((await members('chi', '?page=1e20')).status).toBe(422)
        expect(outcome(await members('phong', ''))).toEqual([404, 'NOT_FOUND_ERROR'])
    })
})
