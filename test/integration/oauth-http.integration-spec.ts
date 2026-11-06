import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { OAUTH_PROVIDERS } from '@/modules/auth/application/ports'
import { OpenIdConnectProvider } from '@/modules/auth/infrastructure/adapters/openid-connect-provider.adapter'
import { FakeOidcIssuer, FakeIdentity } from './fake-oidc-issuer'
import { bootApp, closeApp, cookieOf, FRONTEND, pair } from './helpers'
import { testClientIp } from './targets'

/**
 * Signing in with another provider over HTTP, through the whole app, against
 * a fake OpenID Connect provider (fake-oidc-issuer.ts) that checks what
 * Google checks. The app's own adapter, openid-client, does the talking — so
 * PKCE, the nonce, the ID token's signature and audience are all really
 * checked here. What the fake cannot show is Google itself: that is the
 * manual test (docs/auth/google-sign-in.md, "Logs, metrics and tests").
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Sign-in with another provider over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const issuer = new FakeOidcIssuer()

    let app: NestExpressApplication

    const api = () => request(app.getHttpServer())
    const address = () => `itest-oauth-${randomUUID()}@example.test`
    const person = (email: string): FakeIdentity => ({
        sub: `sub-${randomUUID()}`,
        email,
        email_verified: true,
        name: 'Ada Lovelace'
    })

    /** The whole sign-in, as a browser would do it: leave for the provider, come back with its code. */
    async function signInAs(identity: FakeIdentity) {
        const left = await api().get('/api/v1/auth/google?redirect=%2Fprofile').set('X-Forwarded-For', CLIENT_IP)
        expect(left.status).toBe(302)
        const state = new URL(left.headers.location).searchParams.get('state')!
        // Not Strict: the browser would drop it on the way back from Google, and nobody could sign in.
        expect(cookieOf(left, 'oauth_state')).toMatch(/SameSite=Lax/i)
        const code = issuer.approve(left.headers.location, identity)
        return api()
            .get(`/api/v1/auth/google/callback?code=${code}&state=${state}&scope=openid%20email%20profile`)
            .set('X-Forwarded-For', CLIENT_IP)
            .set('Cookie', pair(cookieOf(left, 'oauth_state')))
    }

    const errorOf = (res: request.Response) => new URL(res.headers.location).searchParams.get('error')

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
    })

    afterAll(async () => {
        await app
            ?.get(PrismaService)
            .user.deleteMany({ where: { email: { startsWith: 'itest-oauth-' } } })
            .catch(() => undefined)
        await closeApp(app)
        await issuer.stop()
    })

    it('signs in with a valid ID token, and refuses one for another sign-in, another app, or signed with an unknown key', async () => {
        const email = address()
        const res = await signInAs(person(email))
        expect(res.headers.location).toBe(`${FRONTEND}/auth/callback?redirect=%2Fprofile`)
        const refreshed = await api()
            .post('/api/v1/auth/refresh')
            .set('Origin', FRONTEND)
            .set('Cookie', pair(cookieOf(res, 'refresh_token')))
        const me = await api()
            .get('/api/v1/users/me')
            .set('Authorization', `Bearer ${refreshed.body.data.access_token}`)
        expect(me.body.data).toMatchObject({ email })

        try {
            for (const tamper of [
                { nonce: 'someone-elses' },
                { audience: 'another-client' },
                { signWith: await issuer.strangerKey() }
            ]) {
                issuer.tamper = tamper
                const refused = await signInAs(person(address()))
                expect({ tamper: Object.keys(tamper)[0], error: errorOf(refused) }).toEqual({
                    tamper: Object.keys(tamper)[0],
                    error: 'failed'
                })
                expect(cookieOf(refused, 'refresh_token')).toBeUndefined()
            }
        } finally {
            issuer.tamper = {}
        }
    })
})
