import { randomUUID } from 'crypto'
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

/** A POST from one client of the web app, signed in or not. */
export type Post = (path: string, body?: object, accessToken?: string) => request.Test

/** The code in the newest email whose subject contains `subject`, once it is not `previous` (an earlier email's). */
export async function newCodeIn(to: string, subject: string, previous?: string): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt++) {
        const code = codeIn(await latestEmail(to, subject))
        if (code !== previous) return code
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`No new "${subject}" email reached ${to}`)
}

/**
 * Signs in with an emailed code, as the "create an account" and "sign in
 * with a code" pages do; makes the account if the address has none. Every
 * code email's subject has "code" in it, in English (no `language` sent).
 */
export async function signInWithCode(post: Post, email: string, previousCode?: string) {
    expect((await post('auth/email-code', { email })).status).toBe(202)
    const code = await newCodeIn(email, 'code', previousCode)
    const verified = await post('auth/email-code/verify', { email, code })
    expect(verified.status).toBe(200)
    return {
        accessToken: verified.body.data.access_token as string,
        account: verified.body.data.account as { created: boolean; completed: boolean },
        code,
        response: verified
    }
}

/**
 * Gives an account without a password (made by a code, or with Google) its
 * first one through "forgot password", which signs in again (every earlier
 * session ends): returns the new access token. `beforeEmail` runs first: one
 * code email a minute per address, so a test that just sent one resets that
 * count there.
 */
export async function setFirstPassword(post: Post, email: string, password: string, beforeEmail: () => Promise<void>) {
    await beforeEmail()
    expect((await post('auth/forgot-password', { email })).status).toBe(202)
    const code = await newCodeIn(email, 'Choose a password')
    const reset = await post('auth/reset-password', { email, code, password })
    expect(reset.status).toBe(200)
    return reset.body.data.access_token as string
}

/** A username no other run uses: `itest_` and eight hex digits. */
export const freshUsername = () => `itest_${randomUUID().slice(0, 8)}`

/**
 * The "complete your account" step (D-61), as the welcome page sends it.
 * Until it is done, every signed-in route but that page's answers
 * ACCOUNT_INCOMPLETE; afterwards the same access token works everywhere.
 */
export async function completeAccount(post: Post, accessToken: string, password: string, username = freshUsername()) {
    const done = await post(
        'auth/complete-account',
        {
            display_name: 'Ada',
            username,
            password,
            timezone: 'Asia/Ho_Chi_Minh',
            language: 'en',
            terms_accepted: true
        },
        accessToken
    )
    expect([done.status, done.body.meta?.type]).toEqual([200, undefined])
    return username
}
