import { randomUUID } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { AUTH_RATE_LIMITS } from '@/modules/auth/application/rate-limits'
import {
    bootApp,
    closeApp,
    cookieOf,
    FRONTEND,
    latestEmail,
    newCodeIn,
    pair,
    setFirstPassword,
    signInWithCode
} from './helpers'
import { testClientIp, testIPv6Network } from './targets'

/**
 * Signing in over HTTP, through the whole app: the real AppModule, the same
 * pipeline main.ts builds, and real Postgres, Redis and Mailpit. What the unit
 * and adapter suites cannot show lives here — routes and guards wired in the
 * right order, the cookie's flags and path, the Origin check, codes that
 * really arrive by email, and limits counted per client network.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Auth over HTTP (integration)', () => {
    // Its own client address, so no limit counted by another run applies.
    const CLIENT_IP = testClientIp()
    const EMAIL = `itest-http-${randomUUID()}@example.test`
    const PASSWORD = 'Harbour-Lantern-42'

    let app: NestExpressApplication

    const api = () => request(app.getHttpServer())
    const post = (path: string, body: object = {}) =>
        api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND).send(body)
    /** As if a minute went by: one code email a minute per address. */
    const nextMinute = (email: string) => app.get(RateLimiter).reset(AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, email)
    const me = (accessToken: string) => api().get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`)

    beforeAll(async () => {
        app = await bootApp()
    })

    afterAll(async () => {
        await app
            ?.get(PrismaService)
            .user.deleteMany({ where: { email: { startsWith: 'itest-http-' } } })
            .catch(() => undefined)
        await closeApp(app)
    })

    it('makes the account with an emailed code, and signs in to it with the next one, in the language of the page', async () => {
        const email = `itest-http-${randomUUID()}@example.test`
        const created = await signInWithCode(post, email)
        expect(created.account).toEqual({ created: true, completed: false })
        expect(cookieOf(created.response, 'refresh_token')).toMatch(/; HttpOnly/)
        expect((await me(created.accessToken)).body.data).toMatchObject({ email })
        await latestEmail(email, 'create')

        // The same address again, from a Vietnamese page: a sign-in, worded so, and no new account.
        await nextMinute(email)
        expect((await post('auth/email-code', { email, language: 'vi' })).status).toBe(202)
        const code = await newCodeIn(email, 'Mã OTP đăng nhập', created.code)
        const again = await post('auth/email-code/verify', { email, code })
        expect(again.body.data.account).toEqual({ created: false, completed: false })
        expect((await me(again.body.data.access_token)).body.data.id).toBe((await me(created.accessToken)).body.data.id)
        // Used up.
        const reused = await post('auth/email-code/verify', { email, code })
        expect([reused.status, reused.body.meta.type]).toEqual([400, 'AUTH_CODE_INVALID'])
    })

    it('gives the account a password, signs in with it, refreshes from the web app only, and signs out', async () => {
        await signInWithCode(post, EMAIL)
        await setFirstPassword(post, EMAIL, PASSWORD, () => nextMinute(EMAIL))

        // A bearer token in the body, the refresh token only in an httpOnly cookie on the auth path.
        const login = await post('auth/login', { email: EMAIL.toUpperCase(), password: PASSWORD })
        expect(login.status).toBe(200)
        expect(JSON.stringify(login.body)).not.toContain('refresh')
        const set = cookieOf(login, 'refresh_token')!
        expect(set).toMatch(/; HttpOnly/)
        expect(set).toMatch(/; Path=\/api\/v1\/auth/)
        expect(set).toMatch(/; SameSite=Lax/)
        expect((await me(login.body.data.access_token)).body.data).toMatchObject({ email: EMAIL, roles: ['user'] })
        const forged = await me(`${login.body.data.access_token.slice(0, -4)}AAAA`)
        expect([forged.status, forged.body.meta.type]).toEqual([401, 'AUTH_TOKEN_INVALID'])

        // A page on another site cannot use the cookie.
        const foreign = await api()
            .post('/api/v1/auth/refresh')
            .set('Origin', 'https://elsewhere.example')
            .set('Cookie', pair(set))
        expect([foreign.status, foreign.body.meta.type]).toEqual([403, 'AUTH_FORBIDDEN'])
        const refreshed = await post('auth/refresh').set('Cookie', pair(set))
        expect(refreshed.status).toBe(200)
        const cookie = pair(cookieOf(refreshed, 'refresh_token'))
        expect(cookie).not.toBe(pair(set))

        // Signing out ends the session at once: the access token and the cookie stop working.
        expect((await post('auth/logout').set('Cookie', cookie)).status).toBe(200)
        const after = await me(refreshed.body.data.access_token)
        expect([after.status, after.body.meta.type]).toEqual([401, 'AUTH_TOKEN_REVOKED'])
        expect((await post('auth/refresh').set('Cookie', cookie)).status).toBe(401)
    })

    it('counts an IPv6 client by its /64, not by the address it picked for each request', async () => {
        const [network, neighbour] = [testIPv6Network(), testIPv6Network()]
        const attempt = (ip: string) =>
            api()
                .post('/api/v1/auth/login')
                .set('X-Forwarded-For', ip)
                .send({ email: `itest-http-nobody-${randomUUID()}@example.test`, password: 'Wrong-Password-1' })

        // A new address of the same /64 for every failed sign-in.
        for (let i = 0; i < 10; i++) expect((await attempt(network())).status).toBe(401)
        expect((await attempt(network())).status).toBe(429)
        expect((await attempt(neighbour())).status).toBe(401)

        // The global throttler too: THROTTLE_LIMIT requests a minute per route, per /64.
        const limit = app.get(ConfigService).get<number>('throttle.limit')!
        const options = (ip: string) => api().get('/api/v1/auth/options').set('X-Forwarded-For', ip)
        // One at a time: the app is not listening, so supertest starts the
        // server for each request, and requests sent together reset each other.
        for (let sent = 0; sent < limit; sent++) expect((await options(network())).status).toBe(200)
        expect((await options(network())).status).toBe(429)
        expect((await options(neighbour())).status).toBe(200)
    })
})
