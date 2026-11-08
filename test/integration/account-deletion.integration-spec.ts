import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import { CommandBus } from '@nestjs/cqrs'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { AUTH_RATE_LIMITS } from '@/modules/auth/application/rate-limits'
import { OAUTH_PROVIDERS } from '@/modules/auth/application/ports'
import { OpenIdConnectProvider } from '@/modules/auth/infrastructure/adapters/openid-connect-provider.adapter'
import { SweepDeletedAccountsCommand } from '@/modules/users'
import { FakeOidcIssuer, FakeIdentity } from './fake-oidc-issuer'
import { bootApp, closeApp, completeAccount, cookieOf, FRONTEND, pair, signInWithCode } from './helpers'
import { testClientIp } from './targets'

const DAY_MS = 24 * 60 * 60 * 1000
const PASSWORD = 'Harbour-Lantern-42'

/**
 * Deleting an account waits 14 days (REQ-AUTH-09, D-141). Meanwhile the
 * account is live: its address and username stay taken, and every way of
 * signing in (password, code, Google) finds it again, to restore it. Once the
 * sweep has deleted it, the address is free and coming back makes a new
 * account. Only the real database can show this: the rules are the partial
 * unique indexes and the conditional writes.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Deleting an account, and coming back (integration)', () => {
    const CLIENT_IP = testClientIp()
    const issuer = new FakeOidcIssuer()

    let app: NestExpressApplication
    let prisma: PrismaService
    /** Every account a test made: erased ones have no address left to find them by. */
    const made: string[] = []

    const api = () => request(app.getHttpServer())
    const post = (path: string, body: object = {}, accessToken?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        if (accessToken) req.set('Authorization', `Bearer ${accessToken}`)
        return req.send(body)
    }
    const get = (path: string, accessToken: string) =>
        api().get(`/api/v1/${path}`).set('Authorization', `Bearer ${accessToken}`)
    const me = (accessToken: string) => get('users/me', accessToken)
    /** As if a minute went by: one code email a minute per address. */
    const nextMinute = (email: string) => app.get(RateLimiter).reset(AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, email)
    const login = (email: string) => post('auth/login', { email, password: PASSWORD })
    const refreshWith = (cookie: string) => post('auth/refresh').set('Cookie', cookie)
    /** As if the 14 days went by: the request moves back, then the sweep runs. */
    async function fourteenDaysLater(userId: string) {
        await prisma.user.update({
            where: { id: userId },
            data: { deletionRequestedAt: new Date(Date.now() - 14 * DAY_MS - 1000) }
        })
        await app.get(CommandBus).execute(new SweepDeletedAccountsCommand(new Date()))
    }

    /** Signs in with the fake Google, as a browser would; returns the session's access token. */
    async function signInWithGoogle(identity: FakeIdentity) {
        const left = await api().get('/api/v1/auth/google').set('X-Forwarded-For', CLIENT_IP)
        const state = new URL(left.headers.location).searchParams.get('state')!
        const back = await api()
            .get(`/api/v1/auth/google/callback?code=${issuer.approve(left.headers.location, identity)}&state=${state}`)
            .set('X-Forwarded-For', CLIENT_IP)
            .set('Cookie', pair(cookieOf(left, 'oauth_state')))
        expect(new URL(back.headers.location).searchParams.get('error')).toBeNull()
        const refreshed = await refreshWith(pair(cookieOf(back, 'refresh_token')))
        expect(refreshed.status).toBe(200)
        return refreshed.body.data.access_token as string
    }

    /**
     * A completed account with a password; returns its id, address, the
     * sign-in's refresh cookie, and the code that made it (so a later code
     * sign-in waits for a newer email instead of reading this one).
     */
    async function completedAccount() {
        const email = `itest-deletion-${randomUUID()}@example.test`
        const first = await signInWithCode(post, email)
        await completeAccount(post, first.accessToken, PASSWORD)
        const id = (await me(first.accessToken)).body.data.id as string
        made.push(id)
        const signedIn = await login(email)
        expect(signedIn.status).toBe(200)
        return {
            id,
            email,
            accessToken: signedIn.body.data.access_token as string,
            cookie: pair(cookieOf(signedIn, 'refresh_token')),
            code: first.code
        }
    }

    beforeAll(async () => {
        await issuer.start()
        app = await bootApp((builder) =>
            builder.overrideProvider(OAUTH_PROVIDERS).useValue([
                new OpenIdConnectProvider({
                    id: 'google',
                    displayName: 'Google',
                    issuer: issuer.url,
                    clientId: issuer.clientId,
                    clientSecret: issuer.clientSecret,
                    allowInsecureRequests: true
                })
            ])
        )
        prisma = app.get(PrismaService)
    })

    afterAll(async () => {
        await prisma?.user
            .deleteMany({ where: { OR: [{ email: { startsWith: 'itest-deletion-' } }, { id: { in: made } }] } })
            .catch(() => undefined)
        await closeApp(app)
        await issuer.stop()
    })

    it('waits 14 days: the answer says until when, and every session ends', async () => {
        const account = await completedAccount()
        // The password is the proof, and required.
        const bare = await post('auth/account/delete', {}, account.accessToken)
        expect([bare.status, bare.body.meta.type]).toEqual([422, 'VALIDATION_ERROR'])

        const asked = await post('auth/account/delete', { password: PASSWORD }, account.accessToken)

        expect(asked.status).toBe(200)
        const deletesAt = new Date(asked.body.data.deletes_at)
        expect(deletesAt.getTime() - Date.now()).toBeGreaterThan(14 * DAY_MS - 60_000)
        expect(String(asked.headers['set-cookie'])).toMatch(/refresh_token=;/)
        // The access token in hand stops working at once.
        expect((await me(account.accessToken)).status).toBe(401)
    })

    it('tells another device why it was signed out, and until when it can restore', async () => {
        const account = await completedAccount()
        const other = await login(account.email)
        const otherCookie = pair(cookieOf(other, 'refresh_token'))

        const asked = await post('auth/account/delete', { password: PASSWORD }, account.accessToken)

        const refused = await refreshWith(otherCookie)
        expect(refused.status).toBe(401)
        expect(refused.body.data).toMatchObject({ reason: 'account_deleted', deletes_at: asked.body.data.deletes_at })
    })

    it('signs in again by password or by code to the same account, which can only restore itself', async () => {
        const account = await completedAccount()
        await post('auth/account/delete', { password: PASSWORD }, account.accessToken)

        const byPassword = await login(account.email)
        expect(byPassword.status).toBe(200)
        await nextMinute(account.email)
        const byCode = await signInWithCode(post, account.email, account.code)
        // Kiểm 2 review, A7: no new account behind the address.
        expect(byCode.account).toEqual({ created: false, completed: true })

        for (const token of [byPassword.body.data.access_token as string, byCode.accessToken]) {
            const profile = (await me(token)).body.data
            expect(profile).toMatchObject({ id: account.id, deletes_at: expect.any(String) })
            const elsewhere = await get('users/me/settings', token)
            expect([elsewhere.status, elsewhere.body.meta.type]).toEqual([403, 'ACCOUNT_PENDING_DELETION'])
        }
    })

    it('restores it: every route answers again, and a device signed out by the request is told nothing is deleted', async () => {
        const account = await completedAccount()
        await post('auth/account/delete', { password: PASSWORD }, account.accessToken)
        const again = (await login(account.email)).body.data.access_token as string

        const restored = await post('auth/account/restore', {}, again)

        expect(restored.status).toBe(200)
        expect((await me(again)).body.data.deletes_at).toBeNull()
        expect((await get('users/me/settings', again)).status).toBe(200)
        const before = await refreshWith(account.cookie)
        expect(before.status).toBe(401)
        expect(before.body.data).toMatchObject({ reason: 'revoked' })
        expect(before.body.data).not.toHaveProperty('deletes_at')
    })

    it('holds the username while it waits (Kiểm 2 review, B8)', async () => {
        const account = await completedAccount()
        const username = (await me(account.accessToken)).body.data.username as string
        await post('auth/account/delete', { password: PASSWORD }, account.accessToken)

        const someoneElse = await signInWithCode(post, `itest-deletion-${randomUUID()}@example.test`)
        const check = await get(`users/username-available/${username}`, someoneElse.accessToken)
        expect(check.body.data).toEqual({ available: false })
    })

    it('after 14 days, frees the address: coming back by code makes a new account, the old password does nothing', async () => {
        const account = await completedAccount()
        await post('auth/account/delete', { password: PASSWORD }, account.accessToken)

        await fourteenDaysLater(account.id)

        // A device signed out by the request, coming back after the sweep: the
        // account is gone, with no date left to offer (Kiểm 3 review).
        const late = await refreshWith(account.cookie)
        expect(late.status).toBe(401)
        expect(late.body.data).toMatchObject({ reason: 'account_deleted' })
        expect(late.body.data).not.toHaveProperty('deletes_at')

        const oldLogin = await login(account.email)
        expect([oldLogin.status, oldLogin.body.meta.type]).toEqual([401, 'AUTH_INVALID_CREDENTIALS'])
        await nextMinute(account.email)
        const second = await signInWithCode(post, account.email, account.code)
        expect(second.account).toEqual({ created: true, completed: false })
        expect((await me(second.accessToken)).body.data.id).not.toBe(account.id)
        expect(await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
            email: null,
            username: null
        })
    })

    it('signs in with Google to the account waiting, and after 14 days to a new one', async () => {
        const email = `itest-deletion-${randomUUID()}@example.test`
        const identity: FakeIdentity = { sub: `sub-${randomUUID()}`, email, email_verified: true, name: 'Ada' }
        const first = await signInWithGoogle(identity)
        const oldId = (await me(first)).body.data.id
        made.push(oldId)
        await completeAccount(post, first, PASSWORD)
        await post('auth/account/delete', { password: PASSWORD }, first)

        const waiting = await signInWithGoogle(identity)
        expect((await me(waiting)).body.data).toMatchObject({ id: oldId, deletes_at: expect.any(String) })

        await fourteenDaysLater(oldId)
        // The Google link goes in the handler of the deletion event, after the sweep: wait for it.
        for (let attempt = 0; attempt < 40; attempt++) {
            if ((await prisma.oAuthAccount.count({ where: { userId: oldId } })) === 0) break
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const fresh = await signInWithGoogle(identity)
        expect((await me(fresh)).body.data.id).not.toBe(oldId)
    })
})
