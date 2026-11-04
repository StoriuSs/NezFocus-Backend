import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { CAPTCHA } from '@/modules/auth/application/ports'
import {
    AesSecretBox,
    ENCRYPTION_KEYS,
    EncryptionKeys
} from '@/modules/auth/infrastructure/adapters/aes-secret-box.adapter'
import { TurnstileCaptcha } from '@/modules/auth/infrastructure/adapters/turnstile-captcha.adapter'
import { rotateSecrets } from '@/bootstrap/rotate-encryption-key'
import { bootApp, closeApp, codeIn, FRONTEND, latestEmail, totpCode } from './helpers'
import { databaseTarget, testClientIp } from './targets'

/**
 * Changing AUTH_ENCRYPTION_KEY, through the whole app and the real database:
 * with the old key as AUTH_ENCRYPTION_KEY_PREVIOUS everyone signs in and the
 * secret is sealed again, and `pnpm auth:rotate-key` (its function, run here)
 * seals again what is left, so the old key can go.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Changing the encryption key (integration)', () => {
    // Each boot of the app needs more than Jest's default 30 s.
    const BOOT_TIMEOUT = 120_000
    const OLD = 'a1'.repeat(32)
    const NEW = 'b2'.repeat(32)
    const CLIENT_IP = testClientIp()
    const EMAIL = `itest-key-${randomUUID()}@example.test`
    const PASSWORD = 'Harbour-Lantern-42'

    let app: NestExpressApplication | undefined
    let secret: string
    let userId: string
    // The command's own client, as it runs it: not the app's PrismaService.
    let pool: Pool
    let tools: PrismaClient

    const post = (path: string, body: object = {}, token?: string) => {
        const req = request(app!.getHttpServer())
            .post(`/api/v1/${path}`)
            .set('X-Forwarded-For', CLIENT_IP)
            .set('Origin', FRONTEND)
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }

    /** The app, (re)started with these keys, as after editing the env file. */
    async function boot(keys: EncryptionKeys): Promise<void> {
        await closeApp(app)
        app = await bootApp((builder) =>
            builder
                .overrideProvider(CAPTCHA)
                .useValue(new TurnstileCaptcha({ siteKey: '', secretKey: '' }))
                .overrideProvider(ENCRYPTION_KEYS)
                .useValue(keys)
        )
    }

    const sealedSecret = async () =>
        (await app!.get(PrismaService).twoFactor.findUniqueOrThrow({ where: { userId } })).secretSealed

    beforeAll(async () => {
        pool = new Pool({ connectionString: databaseTarget.url })
        tools = new PrismaClient({ adapter: new PrismaPg(pool) })
        await boot({ current: OLD })

        // An account with two-step sign-in on, under the old key.
        expect((await post('auth/register', { email: EMAIL, password: PASSWORD })).status).toBe(202)
        const code = codeIn(await latestEmail(EMAIL, 'Verify'))
        const verified = await post('auth/verify-email', { email: EMAIL, code, password: PASSWORD })
        const token = verified.body.data.access_token as string
        secret = (await post('auth/2fa/setup', {}, token)).body.data.secret
        expect((await post('auth/2fa/confirm', { code: totpCode(secret) }, token)).status).toBe(200)
        userId = (await app!.get(PrismaService).user.findFirstOrThrow({ where: { email: EMAIL } })).id
    }, BOOT_TIMEOUT)

    afterAll(async () => {
        await tools?.user.deleteMany({ where: { email: { startsWith: 'itest-key-' } } }).catch(() => undefined)
        await closeApp(app)
        await tools?.$disconnect()
        await pool?.end()
    })

    it(
        'with the old key as the previous one, signs in and seals the secret again; auth:rotate-key seals what is left',
        async () => {
            await boot({ current: NEW, previous: OLD })
            const first = await post('auth/login', { email: EMAIL, password: PASSWORD })
            expect([first.status, first.body.meta.type]).toEqual([403, 'AUTH_TWO_FACTOR_REQUIRED'])
            // The next 30-second step: this one turned two-step sign-in on.
            const done = await post('auth/login/2fa', {
                challenge: first.body.data.challenge,
                code: totpCode(secret, 30_000)
            })
            expect(done.status).toBe(200)
            expect(new AesSecretBox({ current: NEW }).open(await sealedSecret()).plaintext).toBe(secret)

            // A secret still under the old key, as for someone who has not signed in since.
            await app!.get(PrismaService).twoFactor.update({
                where: { userId },
                data: { secretSealed: new AesSecretBox({ current: OLD }).seal(secret) }
            })
            const report = await rotateSecrets(tools, new AesSecretBox({ current: NEW, previous: OLD }))
            expect(report.resealed).toBeGreaterThanOrEqual(1)
            expect(new AesSecretBox({ current: NEW }).open(await sealedSecret()).plaintext).toBe(secret)
        },
        BOOT_TIMEOUT
    )
})
