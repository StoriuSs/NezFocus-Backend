import { validationSchema } from './validation'

/** The smallest environment that validates in development. */
const devEnv = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    DB_NAME: 'db',
    DB_USERNAME: 'u',
    DB_PASSWORD: 'p',
    JWT_SECRET: 'dev-only-secret-dev-only-secret-00'
}

const strong = 'k3Q9-vT7w-pL2x'

const prodEnv = {
    ...devEnv,
    NODE_ENV: 'production',
    DB_PASSWORD: strong,
    REDIS_PASSWORD: strong,
    BULL_BOARD_PASSWORD: strong,
    JWT_SECRET: '6f1c0a9e4b27d85f3a90c1e2b7d4f6a8c3e5b1d9f0a2c4e6b8d0f1a3c5e7b9d1',
    CORS_CREDENTIALS: 'true',
    ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/AbC-token',
    EMAIL_HOST: 'smtp-relay.example.com',
    FRONTEND_URL: 'https://app.example.com',
    BASE_URL: 'https://api.example.com',
    LIVEKIT_URL: 'wss://nezfocus.livekit.cloud',
    LIVEKIT_API_KEY: 'nezfocus-production',
    LIVEKIT_API_SECRET: strong.repeat(3)
}

const errorFor = (env: Record<string, string | undefined>) =>
    validationSchema.validate(env, { abortEarly: true }).error?.message

describe('validationSchema in production', () => {
    it('refuses a missing, weak or template-placeholder secret', () => {
        expect(errorFor(prodEnv)).toBeUndefined()
        expect(errorFor({ ...prodEnv, DB_PASSWORD: 'short-1' })).toContain('DB_PASSWORD')
        expect(errorFor({ ...prodEnv, REDIS_PASSWORD: 'your_strong_password_here' })).toContain('placeholder')
        // Missing: the development default ("admin") must not get through.
        expect(errorFor({ ...prodEnv, BULL_BOARD_PASSWORD: undefined })).toContain('BULL_BOARD_PASSWORD')
        expect(errorFor({ ...prodEnv, JWT_SECRET: 'your_jwt_secret_at_least_32_characters_long' })).toContain(
            'template placeholder'
        )
        expect(errorFor({ ...prodEnv, JWT_SECRET: 'x'.repeat(31) })).toContain('at least 32 characters')
    })

    // docker-compose.prod.yaml builds DATABASE_URL from these as they are: an
    // @ or / in the password made a URL the app could not connect with.
    it('refuses a database value DATABASE_URL could not carry as it is, without printing it', () => {
        for (const value of ['k3Q9@vT7w-pL2x', 'k3Q9/vT7w-pL2x']) {
            const message = errorFor({ ...prodEnv, DB_PASSWORD: value })
            expect(message).toContain('DB_PASSWORD')
            expect(message).not.toContain(value)
        }
        expect(errorFor({ ...prodEnv, DB_USERNAME: 'app:user' })).toContain('DB_USERNAME')
    })

    it('requires the addresses a release depends on: web app, API, SMTP host and alert webhook', () => {
        expect(errorFor({ ...prodEnv, FRONTEND_URL: undefined })).toContain('FRONTEND_URL" is required in production')
        expect(errorFor({ ...prodEnv, BASE_URL: undefined })).toContain('BASE_URL" is required in production')
        expect(errorFor({ ...prodEnv, EMAIL_HOST: '' })).toContain('EMAIL_HOST" is required in production')
        expect(errorFor({ ...prodEnv, ALERT_WEBHOOK_URL: undefined })).toContain('required in production')
        expect(
            errorFor({
                ...prodEnv,
                ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/your-webhook-id/your-webhook-token'
            })
        ).toContain('placeholder')
    })

    // D-204: development, the tests and CI run LiveKit locally with its
    // development key; a release talks to LiveKit Cloud.
    it('requires LiveKit settings of its own: a wss address and a key and secret that are not the development ones', () => {
        expect(errorFor({ ...prodEnv, LIVEKIT_URL: undefined })).toContain('LIVEKIT_URL" is required in production')
        expect(errorFor({ ...prodEnv, LIVEKIT_URL: 'ws://nezfocus.livekit.cloud' })).toContain('LIVEKIT_URL')
        expect(errorFor({ ...prodEnv, LIVEKIT_API_KEY: undefined })).toContain('LIVEKIT_API_KEY')
        expect(errorFor({ ...prodEnv, LIVEKIT_API_KEY: 'devkey' })).toContain('LIVEKIT_API_KEY')
        expect(errorFor({ ...prodEnv, LIVEKIT_API_SECRET: undefined })).toContain('LIVEKIT_API_SECRET')
        expect(errorFor({ ...prodEnv, LIVEKIT_API_SECRET: 'secret' })).toContain('LIVEKIT_API_SECRET')
        expect(errorFor({ ...prodEnv, LIVEKIT_API_SECRET: strong })).toContain('at least 32 characters')
    })
})

describe('validationSchema for the database pool', () => {
    // A voice lock holder needs a second connection for its work (backend-review M4 14.2): one alone waits on itself.
    it('refuses a pool of one connection', () => {
        expect(errorFor({ ...devEnv, DB_POOL_MAX: '1' })).toContain('DB_POOL_MAX')
        expect(errorFor({ ...devEnv, DB_POOL_MAX: '2' })).toBeUndefined()
    })
})

describe('validationSchema in development', () => {
    it('defaults LiveKit to the local development server (docker-compose.dev.yaml), also for an empty line', () => {
        const empty = { LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' }
        for (const env of [devEnv, { ...devEnv, ...empty }]) {
            const { value, error } = validationSchema.validate(env)
            expect(error).toBeUndefined()
            expect(value).toMatchObject({
                LIVEKIT_URL: 'ws://localhost:7880',
                LIVEKIT_API_KEY: 'devkey',
                LIVEKIT_API_SECRET: 'secret'
            })
        }
    })
})
