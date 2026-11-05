import { Test, TestingModuleBuilder } from '@nestjs/testing'
import { NestExpressApplication } from '@nestjs/platform-express'
import { register } from 'prom-client'
import request from 'supertest'
import { configureApp } from '@/bootstrap/configure-app'
import { databaseTarget, redisTarget, smtpTarget } from './targets'

/** What the integration suites that run the whole app share. */

export const FRONTEND = 'http://localhost:3001'

/**
 * The whole app, as main.ts builds it, against the integration services.
 * `override` replaces providers (a fake Google, other keys).
 */
export async function bootApp(
    override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder
): Promise<NestExpressApplication> {
    Object.assign(process.env, {
        DATABASE_URL: databaseTarget.url,
        REDIS_HOST: redisTarget.host,
        REDIS_PORT: String(redisTarget.port),
        REDIS_PASSWORD: redisTarget.password,
        EMAIL_HOST: smtpTarget.host,
        EMAIL_PORT: String(smtpTarget.port),
        EMAIL_SECURE: 'false',
        EMAIL_USER: '',
        EMAIL_PASSWORD: '',
        API_PREFIX: 'api',
        BASE_URL: 'http://api.itest.example',
        CORS_ORIGINS: FRONTEND,
        FRONTEND_URL: FRONTEND,
        CORS_CREDENTIALS: 'true',
        // Every refused request logs a warning; the assertions say more.
        LOG_LEVEL: 'silent'
    })
    // One process, several apps: the metrics registry is global, and each app
    // registers the same metrics in it.
    register.clear()
    // After the environment is set: config is read as modules load.
    const { AppModule } = require('@/app.module') as typeof import('@/app.module')
    const moduleRef = await override(Test.createTestingModule({ imports: [AppModule] })).compile()
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
    configureApp(app)
    await app.init()
    return app
}

/** Closes an app, dropping any request a failed test left half-way (it would hold the server open for minutes). */
export async function closeApp(app: NestExpressApplication | undefined): Promise<void> {
    app?.getHttpServer().closeAllConnections()
    await app?.close()
}

/** The newest email to `to` whose subject contains `subject`, once Mailpit has it. */
export async function latestEmail(to: string, subject: string): Promise<{ Text: string; HTML: string }> {
    // Up to 30 s: the first email after the app starts can be slow.
    for (let attempt = 0; attempt < 120; attempt++) {
        const search = await fetch(`${smtpTarget.apiUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
        const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] }
        const message = messages.find((m) => m.Subject.includes(subject))
        if (message) return (await (await fetch(`${smtpTarget.apiUrl}/api/v1/message/${message.ID}`)).json()) as never
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`No "${subject}" email reached ${to}`)
}

/** The six-digit code in an email. */
export const codeIn = (email: { Text: string }) => /\b(\d{6})\b/.exec(email.Text)![1]

/** The Set-Cookie line a response sent for this cookie. */
export const cookieOf = (res: request.Response, name: string) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`))

/** A Set-Cookie line as the "name=value" the next request sends; says so plainly if an earlier step failed. */
export const pair = (set: string | undefined) => {
    if (!set) throw new Error('No such cookie: an earlier step failed')
    return set.split(';')[0]
}
