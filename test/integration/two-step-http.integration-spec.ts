import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { CAPTCHA } from '@/modules/auth/application/ports'
import { TurnstileCaptcha } from '@/modules/auth/infrastructure/adapters/turnstile-captcha.adapter'
import { bootApp, closeApp, codeIn, cookieOf, FRONTEND, latestEmail, totpCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Two-step sign-in over HTTP, through the whole app: the challenge a right
 * password answers with, and the second step that turns it into a session.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Two-step sign-in over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const EMAIL = `itest-2fa-${randomUUID()}@example.test`
    const PASSWORD = 'Harbour-Lantern-42'

    let app: NestExpressApplication

    const api = () => request(app.getHttpServer())
    const post = (path: string, body: object = {}) =>
        api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND).send(body)

    beforeAll(async () => {
        // Turnstile off, whatever the env file says: this suite is about the second step.
        app = await bootApp((builder) =>
            builder.overrideProvider(CAPTCHA).useValue(new TurnstileCaptcha({ siteKey: '', secretKey: '' }))
        )
    })

    afterAll(async () => {
        await app
            ?.get(PrismaService)
            .user.deleteMany({ where: { email: { startsWith: 'itest-2fa-' } } })
            .catch(() => undefined)
        await closeApp(app)
    })

    it('answers a right password with a challenge, not a session, and signs in on the second step, once', async () => {
        // A confirmed account with two-step sign-in on.
        expect((await post('auth/register', { email: EMAIL, password: PASSWORD })).status).toBe(202)
        const code = codeIn(await latestEmail(EMAIL, 'Verify'))
        const verified = await post('auth/verify-email', { email: EMAIL, code, password: PASSWORD })
        const bearer = { Authorization: `Bearer ${verified.body.data.access_token}` }
        const secret = (await api().post('/api/v1/auth/2fa/setup').set(bearer)).body.data.secret as string
        const confirmed = await api()
            .post('/api/v1/auth/2fa/confirm')
            .set(bearer)
            .send({ code: totpCode(secret) })
        expect(confirmed.status).toBe(200)
        const recoveryCodes = confirmed.body.data.recovery_codes as string[]

        const first = await post('auth/login', { email: EMAIL, password: PASSWORD })
        expect([first.status, first.body.meta.type]).toEqual([403, 'AUTH_TWO_FACTOR_REQUIRED'])
        expect(cookieOf(first, 'refresh_token')).toBeUndefined()
        const challenge = first.body.data.challenge

        const wrong = await post('auth/login/2fa', { challenge, code: '000000' })
        expect([wrong.status, wrong.body.meta.type, wrong.body.data.attempts_left]).toEqual([
            400,
            'AUTH_TWO_FACTOR_CODE_INVALID',
            4
        ])

        const done = await post('auth/login/2fa', { challenge, code: recoveryCodes[0] })
        expect(done.status).toBe(200)
        expect(cookieOf(done, 'refresh_token')).toMatch(/; HttpOnly/)

        const replay = await post('auth/login/2fa', { challenge, code: recoveryCodes[1] })
        expect(replay.body.meta.type).toBe('AUTH_TWO_FACTOR_CHALLENGE_EXPIRED')
    })
})
