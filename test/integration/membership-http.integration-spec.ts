import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import { CommandBus, EventBus } from '@nestjs/cqrs'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { CleanUpServersCommand } from '@/modules/servers'
import { AccountDeletedEvent } from '@/modules/users'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Leaving, deleting and handing over a server through the whole app
 * (REQ-SRV-05, D-76, D-91, D-121, D-160, D-161): each change holds from the
 * very next request, as the permission cache is told after the commit; the
 * account deletion asks the servers module; a deleted account leaves its
 * servers; the daily clean-up deletes for good after 30 days.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Leaving, deleting and handing over a server over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-own-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    const DAY_MS = 24 * 60 * 60 * 1000

    let app: NestExpressApplication
    let prisma: PrismaService
    const users: Record<string, { token: string; id: string }> = {}

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: string, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]
    const url = (serverId: string, path = '') => `/api/v1/servers/${serverId}${path}`

    const leave = (who: string, serverId: string) => as(who, api().delete(url(serverId, '/members/me')))
    const deleteServer = (who: string, serverId: string, name: string) =>
        as(who, api().delete(url(serverId))).send({ name })
    const transfer = (who: string, serverId: string, to: string, password = PASSWORD) =>
        as(who, api().post(url(serverId, '/transfer'))).send({ user_id: users[to].id, password })
    const members = (who: string, serverId: string, query = '') => as(who, api().get(url(serverId, `/members${query}`)))
    const memberIds = async (who: string, serverId: string, query = '') =>
        ((await members(who, serverId, query)).body.data.items as { user_id: string }[]).map((item) => item.user_id)
    const newInvite = (who: string, serverId: string) =>
        as(who, api().post(url(serverId, '/invites')))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
    const listed = async (who: string) =>
        (await as(who, api().get('/api/v1/servers'))).body.data.servers as {
            id: string
            is_owner: boolean
            member_count: number
        }[]

    async function signUp(who: string) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, PASSWORD)
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id }
    }

    /** A server of `owner` with `others` in it through a link. */
    async function serverWith(owner: string, others: string[], name = 'Ôn thi Giải tích 2') {
        const created = await as(owner, api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name, template: 'standard' })
        expect(created.status).toBe(201)
        const serverId: string = created.body.data.id
        const { code } = (await newInvite(owner, serverId)).body.data as { code: string }
        for (const who of others) {
            expect((await as(who, api().post(`/api/v1/invites/${code}/accept`))).status).toBe(200)
        }
        return { serverId, code }
    }

    const isMember = async (who: string, serverId: string) =>
        (await prisma.member.count({ where: { serverId, userId: users[who].id } })) === 1

    async function eventually(check: () => Promise<boolean>) {
        for (let tries = 0; tries < 50; tries++) {
            if (await check()) return
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error('never happened')
    }

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'chi']) await signUp(who)
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

    describe('leaving (S-SRV-04)', () => {
        // Bình may not kick: had the kick route caught "me", this would answer 422 or 403.
        it('takes a member out, and the next request of theirs is refused at once', async () => {
            const { serverId } = await serverWith('an', ['binh'])
            // Their access is in the permission cache now.
            expect((await members('binh', serverId)).status).toBe(200)

            expect((await leave('binh', serverId)).status).toBe(200)

            expect(outcome(await members('binh', serverId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(await isMember('binh', serverId)).toBe(false)
            expect((await listed('binh')).map((server) => server.id)).not.toContain(serverId)
            expect(outcome(await leave('binh', serverId))).toEqual([404, 'NOT_FOUND_ERROR'])
        })

        it('refuses the owner, who hands the server over first', async () => {
            const { serverId } = await serverWith('an', ['binh'])
            expect(outcome(await leave('an', serverId))).toEqual([403, 'OWNER_CANNOT_LEAVE'])
            expect(await isMember('an', serverId)).toBe(true)
        })
    })

    describe('member_count (D-161)', () => {
        it('counts everyone in the server, themselves included', async () => {
            const { serverId } = await serverWith('an', ['binh', 'chi'])
            expect((await listed('an')).find((server) => server.id === serverId)?.member_count).toBe(3)
            await leave('chi', serverId)
            expect((await listed('binh')).find((server) => server.id === serverId)?.member_count).toBe(2)
        })
    })

    describe('deleting (S-SET-07)', () => {
        it('takes the server away from every member at once, and its invites stop', async () => {
            const { serverId, code } = await serverWith('an', ['binh'])
            expect((await members('binh', serverId)).status).toBe(200)

            const wrongName = await deleteServer('an', serverId, 'Ôn thi')
            expect(outcome(wrongName)).toEqual([422, 'VALIDATION_ERROR'])
            expect(wrongName.body.data).toMatchObject({ rule: 'name_mismatch' })
            expect(outcome(await deleteServer('binh', serverId, 'Ôn thi Giải tích 2'))).toEqual([
                403,
                'FORBIDDEN_ERROR'
            ])

            expect((await deleteServer('an', serverId, 'on thi giai tich 2')).status).toBe(200)

            expect(outcome(await members('binh', serverId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await members('an', serverId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect((await listed('an')).map((server) => server.id)).not.toContain(serverId)
            expect(outcome(await anyone(api().get(`/api/v1/invites/${code}`)))).toEqual([410, 'INVITE_INVALID'])
            // Kept 30 days, then deleted for good by the clean-up.
            expect((await prisma.server.findUniqueOrThrow({ where: { id: serverId } })).deletedAt).not.toBeNull()
        })
    })

    describe('handing over (S-SET-07, D-91)', () => {
        it('makes the member the owner from the next request, the old owner keeping their roles', async () => {
            const { serverId } = await serverWith('an', ['binh'])
            const lead = await prisma.role.create({
                data: { serverId, name: 'Trưởng nhóm', nameKey: 'trưởng nhóm', permissions: 0n, position: 1 }
            })
            await prisma.memberRole.create({ data: { serverId, userId: users.an.id, roleId: lead.id } })
            // Both owners' views are cached now.
            expect((await members('an', serverId, '?transferable=true')).status).toBe(200)
            expect(outcome(await members('binh', serverId, '?transferable=true'))).toEqual([403, 'FORBIDDEN_ERROR'])

            expect((await transfer('an', serverId, 'binh')).status).toBe(200)

            expect((await members('binh', serverId, '?transferable=true')).status).toBe(200)
            expect(outcome(await members('an', serverId, '?transferable=true'))).toEqual([403, 'FORBIDDEN_ERROR'])
            expect((await listed('binh')).find((server) => server.id === serverId)?.is_owner).toBe(true)
            expect(await prisma.memberRole.count({ where: { serverId, userId: users.an.id } })).toBe(1)
            // The old owner may leave now; the new one may not.
            expect(outcome(await leave('binh', serverId))).toEqual([403, 'OWNER_CANNOT_LEAVE'])
            expect((await leave('an', serverId)).status).toBe(200)
        })

        it('refuses a wrong password, someone not the owner, a timed-out member and one waiting to be deleted', async () => {
            const { serverId } = await serverWith('an', ['binh', 'chi'])
            expect(outcome(await transfer('an', serverId, 'binh', 'Wrong-Password-1'))).toEqual([
                400,
                'AUTH_CURRENT_PASSWORD_INVALID'
            ])
            expect(outcome(await transfer('binh', serverId, 'chi'))).toEqual([403, 'FORBIDDEN_ERROR'])
            const self = await transfer('an', serverId, 'an')
            expect(outcome(self)).toEqual([422, 'VALIDATION_ERROR'])
            expect(self.body.data).toMatchObject({ rule: 'recipient_self' })

            await prisma.member.update({
                where: { serverId_userId: { serverId, userId: users.binh.id } },
                data: { timeoutUntil: new Date(Date.now() + 60_000) }
            })
            const timedOut = await transfer('an', serverId, 'binh')
            expect(outcome(timedOut)).toEqual([422, 'VALIDATION_ERROR'])
            expect(timedOut.body.data).toMatchObject({ rule: 'recipient_timed_out' })

            await prisma.user.update({ where: { id: users.chi.id }, data: { deletionRequestedAt: new Date() } })
            try {
                const waiting = await transfer('an', serverId, 'chi')
                expect(outcome(waiting)).toEqual([422, 'VALIDATION_ERROR'])
                expect(waiting.body.data).toMatchObject({ rule: 'recipient_pending_deletion' })
            } finally {
                await prisma.user.update({ where: { id: users.chi.id }, data: { deletionRequestedAt: null } })
            }
            expect((await prisma.server.findUniqueOrThrow({ where: { id: serverId } })).ownerId).toBe(users.an.id)
        })

        it('lists for the picker everyone but the owner and accounts waiting to be deleted, owner only', async () => {
            const { serverId } = await serverWith('an', ['binh', 'chi'])
            await prisma.user.update({ where: { id: users.chi.id }, data: { deletionRequestedAt: new Date() } })
            try {
                expect(await memberIds('an', serverId, '?transferable=true')).toEqual([users.binh.id])
                expect((await memberIds('an', serverId)).sort()).toEqual(
                    [users.an.id, users.binh.id, users.chi.id].sort()
                )
                expect(outcome(await members('binh', serverId, '?transferable=true'))).toEqual([403, 'FORBIDDEN_ERROR'])
                expect((await memberIds('binh', serverId, '?transferable=false')).length).toBe(3)
                expect(outcome(await members('an', serverId, '?transferable=yes'))).toEqual([422, 'VALIDATION_ERROR'])
            } finally {
                await prisma.user.update({ where: { id: users.chi.id }, data: { deletionRequestedAt: null } })
            }
        })
    })

    describe('deleting an account (D-76, D-121)', () => {
        it('is refused while they own a server with others, and stops the invites of the ones they own alone', async () => {
            await signUp('dung')
            const shared = await serverWith('dung', ['binh'], 'Nhóm đồ án')
            const alone = await serverWith('dung', [], 'Ghi chú riêng')
            const deleteAccount = () =>
                as('dung', api().post('/api/v1/auth/account/delete')).send({ password: PASSWORD })

            const refused = await deleteAccount()
            expect(outcome(refused)).toEqual([409, 'OWNERSHIP_TRANSFER_REQUIRED'])
            expect(refused.body.data.servers).toEqual([{ id: shared.serverId, name: 'Nhóm đồ án', member_count: 2 }])
            expect(await prisma.invite.count({ where: { serverId: alone.serverId } })).toBe(1)

            expect((await transfer('dung', shared.serverId, 'binh')).status).toBe(200)
            expect((await deleteAccount()).status).toBe(200)

            expect(await prisma.invite.count({ where: { serverId: alone.serverId } })).toBe(0)
            expect(await prisma.invite.count({ where: { serverId: shared.serverId } })).toBe(1)
        })

        it('takes a deleted account out of its servers, with a server it owned alone (AccountDeletedEvent)', async () => {
            await signUp('em')
            const { serverId } = await serverWith('an', ['em'])
            const alone = await serverWith('em', [], 'Một mình')
            // What the permission cache is told is checked in membership.handlers.spec.ts:
            // a deleted account makes no request that would read it.

            await prisma.user.update({ where: { id: users.em.id }, data: { deletedAt: new Date() } })
            app.get(EventBus).publish(new AccountDeletedEvent(users.em.id, true))

            await eventually(async () => !(await isMember('em', serverId)))
            await eventually(
                async () =>
                    (await prisma.server.findUniqueOrThrow({ where: { id: alone.serverId } })).deletedAt !== null
            )
            expect(await memberIds('an', serverId)).toEqual([users.an.id])
        })

        it('finishes in the daily clean-up what a lost event left behind, and only that', async () => {
            await signUp('giang')
            const { serverId } = await serverWith('an', ['binh', 'giang'])
            // Deleted, and the event never handled: no longer counted, still a row.
            await prisma.user.update({ where: { id: users.giang.id }, data: { deletedAt: new Date() } })
            expect((await listed('an')).find((server) => server.id === serverId)?.member_count).toBe(2)
            const roles = (await as('an', api().get(url(serverId, '/roles')))).body.data.roles as {
                is_everyone: boolean
                member_count: number
            }[]
            expect(roles.find((role) => role.is_everyone)?.member_count).toBe(2)

            await app.get(CommandBus).execute(new CleanUpServersCommand(new Date()))

            expect(await isMember('giang', serverId)).toBe(false)
            expect(await isMember('binh', serverId)).toBe(true)
            expect(await isMember('an', serverId)).toBe(true)
        })
    })

    describe('the daily clean-up', () => {
        it('deletes for good the servers deleted more than 30 days ago, and keeps the others', async () => {
            const old = await serverWith('an', ['binh'], 'Cũ')
            const recent = await serverWith('an', [], 'Mới xóa')
            const now = new Date()
            await prisma.server.update({
                where: { id: old.serverId },
                data: { deletedAt: new Date(now.getTime() - 31 * DAY_MS) }
            })
            await prisma.server.update({
                where: { id: recent.serverId },
                data: { deletedAt: new Date(now.getTime() - 29 * DAY_MS) }
            })

            await app.get(CommandBus).execute(new CleanUpServersCommand(now))

            expect(await prisma.server.count({ where: { id: old.serverId } })).toBe(0)
            expect(await prisma.member.count({ where: { serverId: old.serverId } })).toBe(0)
            expect(await prisma.server.count({ where: { id: recent.serverId } })).toBe(1)
        })
    })
})
