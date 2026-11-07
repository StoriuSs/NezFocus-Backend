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
    completeAccount,
    cookieOf,
    FRONTEND,
    latestEmail,
    newCodeIn,
    pair,
    Post,
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

    it('keeps an account made by a code out of the app until it is completed, then lets the same token in', async () => {
        const email = `itest-http-${randomUUID()}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        const signedIn = (req: request.Test) =>
            req.set('Authorization', `Bearer ${accessToken}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        const rename = () =>
            signedIn(api().patch('/api/v1/users/me')).set('Idempotency-Key', randomUUID()).send({ display_name: 'Ada' })
        const complete = (body: object) =>
            signedIn(api().post('/api/v1/auth/complete-account')).send({
                display_name: 'Ada',
                timezone: 'Asia/Ho_Chi_Minh',
                language: 'vi',
                terms_accepted: true,
                ...body
            })
        const typeOf = (res: request.Response) => [res.status, res.body.meta.type]

        // The app is closed; the welcome page's own routes answer.
        expect(typeOf(await rename())).toEqual([403, 'ACCOUNT_INCOMPLETE'])
        expect((await me(accessToken)).body.data).toMatchObject({ email, completed: false })
        expect((await signedIn(api().get('/api/v1/users/username-available/someone_free'))).status).toBe(200)

        // A username taken since the page checked it: decided on submit.
        const holder = `itest_${randomUUID().slice(0, 8)}`
        const prisma = app.get(PrismaService)
        await prisma.user.create({
            data: { email: `itest-http-${randomUUID()}@example.test`, username: holder, completedAt: new Date() }
        })
        expect(typeOf(await complete({ username: holder, password: PASSWORD }))).toEqual([409, 'USERNAME_CONFLICT'])

        // The password may not be the username being chosen (D-66); the Terms must be ticked.
        const username = `itest_${randomUUID().slice(0, 8)}`
        const same = await complete({ username, password: `${username.replace('itest_', 'Itest_')}1!` })
        expect(typeOf(same)).toEqual([422, 'AUTH_PASSWORD_REJECTED'])
        expect(same.body.data.rules).toContain('matches_username')
        for (const terms of [false, 'false', 'yes', 1]) {
            const unticked = await complete({ username, password: PASSWORD, terms_accepted: terms })
            expect(unticked.body.meta.type).toBe('VALIDATION_ERROR')
        }
        const offset = await complete({ username, password: PASSWORD, timezone: '+07:00' })
        expect(offset.body.meta.type).toBe('VALIDATION_ERROR')

        expect((await complete({ username: username.toUpperCase(), password: PASSWORD })).status).toBe(200)

        // The same token, now everywhere.
        expect((await rename()).status).toBe(200)
        expect((await me(accessToken)).body.data).toMatchObject({ completed: true, username })
        const row = await prisma.user.findFirstOrThrow({ where: { email }, include: { settings: true } })
        expect(row.termsAcceptedAt).toBeInstanceOf(Date)
        expect(row.settings).toMatchObject({ timezone: 'Asia/Ho_Chi_Minh', language: 'vi', timezoneChangedAt: null })
        // Signs in with the password chosen there.
        expect((await post('auth/login', { email, password: PASSWORD })).status).toBe(200)
        expect(typeOf(await complete({ username: 'someone_else', password: PASSWORD }))).toEqual([
            409,
            'ACCOUNT_ALREADY_COMPLETE'
        ])
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

    it('lists the devices signed in, ends one by its next request, and signs out all but this one (D-75, D-138)', async () => {
        const email = `itest-http-${randomUUID()}@example.test`
        const CHROME_WINDOWS =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
        const SAFARI_IPHONE =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
        const [laptopIp, phoneIp, phoneLaterIp] = [testClientIp(), testClientIp(), testIPv6Network()()]
        const masked = (ip: string) => `${ip.split('.').slice(0, 2).join('.')}.x.x`
        const withToken: Post = (path, body = {}, accessToken) =>
            post(path, body).set('Authorization', `Bearer ${accessToken}`)
        const from = (ip: string, userAgent: string) => (req: request.Test) =>
            req.set('X-Forwarded-For', ip).set('User-Agent', userAgent).set('Origin', FRONTEND)
        const laptop = from(laptopIp, CHROME_WINDOWS)
        const phone = from(phoneIp, SAFARI_IPHONE)

        const first = await signInWithCode(post, email) // a third device: supertest's own user agent
        await completeAccount(withToken, first.accessToken, PASSWORD)
        const onPhone = await phone(api().post('/api/v1/auth/login')).send({ email, password: PASSWORD })
        const onLaptop = await laptop(api().post('/api/v1/auth/login')).send({ email, password: PASSWORD })
        const asLaptop = (req: request.Test) =>
            laptop(req).set('Authorization', `Bearer ${onLaptop.body.data.access_token}`)
        // The phone refreshes later from another network: the list shows where it was last.
        const phoneCookie = pair(cookieOf(onPhone, 'refresh_token'))
        const refreshed = await from(
            phoneLaterIp,
            SAFARI_IPHONE
        )(api().post('/api/v1/auth/refresh')).set('Cookie', phoneCookie)
        expect(refreshed.status).toBe(200)

        const listed = await asLaptop(api().get('/api/v1/auth/sessions'))
        expect(listed.status).toBe(200)
        const sessions = listed.body.data.sessions as Record<string, unknown>[]
        expect(sessions).toHaveLength(3)
        expect(sessions[0]).toMatchObject({ browser: 'Chrome', os: 'Windows', device: 'desktop', current: true })
        expect(sessions[0].ip).toBe(masked(laptopIp))
        expect(sessions[1]).toMatchObject({ browser: 'Safari', os: 'iOS', device: 'mobile', current: false })
        expect(sessions[1].ip).toBe(`${phoneLaterIp.split(':').slice(0, 2).join(':')}:x:x…`)
        expect(sessions[2]).toMatchObject({ browser: null, current: false })
        expect(Date.parse(sessions[1].last_active_at as string)).toBeGreaterThan(
            Date.parse(sessions[1].signed_in_at as string)
        )
        // Only the network leaves the server.
        for (const ip of [laptopIp, phoneIp, phoneLaterIp]) expect(JSON.stringify(listed.body)).not.toContain(ip)

        // Ending the phone's session: its next request is refused, and its cookie says why.
        const ended = await asLaptop(api().delete(`/api/v1/auth/sessions/${sessions[1].id as string}`))
        expect(ended.status).toBe(200)
        const onPhoneAfter = await me(refreshed.body.data.access_token)
        expect([onPhoneAfter.status, onPhoneAfter.body.meta.type]).toEqual([401, 'AUTH_TOKEN_REVOKED'])
        const phoneRefresh = await phone(api().post('/api/v1/auth/refresh')).set(
            'Cookie',
            pair(cookieOf(refreshed, 'refresh_token'))
        )
        expect([phoneRefresh.status, phoneRefresh.body.data?.reason]).toEqual([401, 'revoked'])
        // Again, or a session that is not there: the same answer.
        expect((await asLaptop(api().delete(`/api/v1/auth/sessions/${sessions[1].id as string}`))).status).toBe(200)
        expect((await asLaptop(api().delete(`/api/v1/auth/sessions/${randomUUID()}`))).status).toBe(200)

        // "Sign out the other devices": the first device goes, this one stays.
        const others = await asLaptop(api().delete('/api/v1/auth/sessions'))
        expect([others.status, others.body.data]).toEqual([200, { revoked: 1 }])
        expect((await me(first.accessToken)).status).toBe(401)
        expect((await me(onLaptop.body.data.access_token)).status).toBe(200)
        const left = await asLaptop(api().get('/api/v1/auth/sessions'))
        expect(left.body.data.sessions).toEqual([expect.objectContaining({ current: true })])
    })

    it('counts an IPv6 client by its /64, not by the address it picked for each request', async () => {
        const [network, neighbour] = [testIPv6Network(), testIPv6Network()]
        const attempt = (ip: string) =>
            api()
                .post('/api/v1/auth/login')
                .set('X-Forwarded-For', ip)
                .send({ email: `itest-http-nobody-${randomUUID()}@example.test`, password: 'Wrong-Password-1' })

        // A new address of the same /64 for every failed sign-in.
        for (let i = 0; i < AUTH_RATE_LIMITS.loginFailuresPerIp.limit; i++) {
            expect((await attempt(network())).status).toBe(401)
        }
        expect((await attempt(network())).status).toBe(429)
        expect((await attempt(neighbour())).status).toBe(401)

        // The global throttler too: THROTTLE_ANONYMOUS_LIMIT requests a minute per route, per /64.
        const limit = app.get(ConfigService).get<number>('throttle.anonymousLimit')!
        const options = (ip: string) => api().get('/api/v1/auth/options').set('X-Forwarded-For', ip)
        // One at a time: the app is not listening, so supertest starts the
        // server for each request, and requests sent together reset each other.
        for (let sent = 0; sent < limit; sent++) expect((await options(network())).status).toBe(200)
        expect((await options(network())).status).toBe(429)
        expect((await options(neighbour())).status).toBe(200)
    })

    it('counts a signed-in user on their own, not with everyone else on their network (D-135)', async () => {
        const { accessToken } = await signInWithCode(post, `itest-http-${randomUUID()}@example.test`)
        const sharedIp = testClientIp()
        const profile = (token?: string) => {
            const call = api().get('/api/v1/users/me').set('X-Forwarded-For', sharedIp)
            return token ? call.set('Authorization', `Bearer ${token}`) : call
        }

        // Everyone without a token on this network uses up its count...
        const limit = app.get(ConfigService).get<number>('throttle.anonymousLimit')!
        for (let sent = 0; sent < limit; sent++) expect((await profile()).status).toBe(401)
        expect((await profile()).status).toBe(429)
        expect((await profile('forged.token.here')).status).toBe(429)

        // ...and the signed-in student on the same network is still answered.
        expect((await profile(accessToken)).status).not.toBe(429)
    })
})
