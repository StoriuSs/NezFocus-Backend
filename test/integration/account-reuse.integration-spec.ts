import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { AUTH_RATE_LIMITS } from '@/modules/auth/application/rate-limits'
import { OAUTH_PROVIDERS } from '@/modules/auth/application/ports'
import { OpenIdConnectProvider } from '@/modules/auth/infrastructure/adapters/openid-connect-provider.adapter'
import { FakeOidcIssuer, FakeIdentity } from './fake-oidc-issuer'
import { bootApp, closeApp, completeAccount, cookieOf, FRONTEND, pair, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * A deleted account's address is free again at once: the row is kept (soft
 * delete) with its address until the retention sweep erases it, but the
 * address is unique among live accounts only (a partial index in Postgres) and
 * every lookup by address skips deleted rows. Coming back, by an emailed code
 * or by Google, is therefore a new account, never the old one revived. Only the real
 * database can show this: the rule is the index and the repository's filter.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Signing up again after deleting the account (integration)', () => {
    const CLIENT_IP = testClientIp()
    const issuer = new FakeOidcIssuer()

    let app: NestExpressApplication
    let prisma: PrismaService

    const api = () => request(app.getHttpServer())
    const post = (path: string, body: object = {}, accessToken?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        if (accessToken) req.set('Authorization', `Bearer ${accessToken}`)
        return req.send(body)
    }
    const me = (accessToken: string) => api().get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`)
    /** As if a minute went by: one code email a minute per address. */
    const nextMinute = (email: string) => app.get(RateLimiter).reset(AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, email)

    /** Signs in with the fake Google, as a browser would; returns the session's access token. */
    async function signInWithGoogle(identity: FakeIdentity) {
        const left = await api().get('/api/v1/auth/google').set('X-Forwarded-For', CLIENT_IP)
        const state = new URL(left.headers.location).searchParams.get('state')!
        const back = await api()
            .get(`/api/v1/auth/google/callback?code=${issuer.approve(left.headers.location, identity)}&state=${state}`)
            .set('X-Forwarded-For', CLIENT_IP)
            .set('Cookie', pair(cookieOf(left, 'oauth_state')))
        expect(new URL(back.headers.location).searchParams.get('error')).toBeNull()
        const refreshed = await post('auth/refresh').set('Cookie', pair(cookieOf(back, 'refresh_token')))
        expect(refreshed.status).toBe(200)
        return refreshed.body.data.access_token as string
    }

    const rowsWith = (email: string) =>
        prisma.user.findMany({ where: { email }, select: { id: true, deletedAt: true }, orderBy: { createdAt: 'asc' } })

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
        await prisma?.user.deleteMany({ where: { email: { startsWith: 'itest-reuse-' } } }).catch(() => undefined)
        await closeApp(app)
        await issuer.stop()
    })

    it('signs up again with the same address: a new account, and the old password does nothing', async () => {
        const email = `itest-reuse-${randomUUID()}@example.test`
        const first = await signInWithCode(post, email)
        const oldId = (await me(first.accessToken)).body.data.id
        await completeAccount(post, first.accessToken, 'Harbour-Lantern-42')

        expect((await post('auth/account/delete', { password: 'Harbour-Lantern-42' }, first.accessToken)).status).toBe(
            200
        )

        // As for an address with no account: the old password was deleted with it.
        const oldLogin = await post('auth/login', { email, password: 'Harbour-Lantern-42' })
        expect([oldLogin.status, oldLogin.body.meta.type]).toEqual([401, 'AUTH_INVALID_CREDENTIALS'])

        // Limits on an address count whether or not it has an account: deleting
        // one does not buy a second code email within the minute.
        const tooSoon = await post('auth/email-code', { email })
        expect([tooSoon.status, tooSoon.body.data.reason]).toEqual([429, 'recent_email'])
        // A minute later it would pass; this test is not about the wait.
        await nextMinute(email)

        const second = await signInWithCode(post, email, first.code)
        expect(second.account).toEqual({ created: true, completed: false })
        const profile = (await me(second.accessToken)).body.data
        expect(profile.email).toBe(email)
        expect(profile.id).not.toBe(oldId)

        // Both rows are there until the retention sweep: the deleted one, and the live one.
        const rows = await rowsWith(email)
        expect(rows.map((row) => [row.id, row.deletedAt !== null])).toEqual([
            [oldId, true],
            [profile.id, false]
        ])
    })

    it('signs in with Google again after deleting the account made with it: a new account', async () => {
        const email = `itest-reuse-${randomUUID()}@example.test`
        const identity: FakeIdentity = { sub: `sub-${randomUUID()}`, email, email_verified: true, name: 'Ada' }
        const first = await signInWithGoogle(identity)
        const oldId = (await me(first)).body.data.id

        // Made with Google, so not completed: nothing but the welcome page until
        // it is, and completing it chooses the password that deletes it.
        const asked = await post('auth/account/delete', {}, first)
        expect([asked.status, asked.body.meta.type]).toEqual([403, 'ACCOUNT_INCOMPLETE'])
        await completeAccount(post, first, 'Harbour-Lantern-42')
        expect((await post('auth/account/delete', { password: 'Harbour-Lantern-42' }, first)).status).toBe(200)

        // The provider link goes with the account, in the handler of its deletion
        // event, which runs after the response: wait for it, as a person would.
        for (let attempt = 0; attempt < 40; attempt++) {
            if ((await prisma.oAuthAccount.count({ where: { userId: oldId } })) === 0) break
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
        // Gone, so this is a first sign-in again.
        const second = await signInWithGoogle(identity)
        const profile = (await me(second)).body.data
        expect(profile).toMatchObject({ email })
        expect(profile.id).not.toBe(oldId)
    })
})
