import { randomUUID } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, codeIn, cookieOf, FRONTEND, latestEmail, pair } from './helpers'
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

    it('signs up, confirms with the sign-up password, signs in, refreshes from the web app only, and signs out', async () => {
        expect((await post('auth/register', { email: EMAIL, password: PASSWORD })).status).toBe(202)
        const code = codeIn(await latestEmail(EMAIL, 'Verify'))
        // The sign-up password is part of confirming: with another, nothing happens.
        const otherPassword = await post('auth/verify-email', { email: EMAIL, code, password: 'Quartz-Meadow-Otter-9' })
        expect([otherPassword.status, otherPassword.body.meta.type]).toEqual([400, 'AUTH_CODE_INVALID'])
        expect((await post('auth/verify-email', { email: EMAIL, code, password: PASSWORD })).status).toBe(200)

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
