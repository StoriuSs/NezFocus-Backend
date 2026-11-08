import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * The settings pages' requests through the whole app (S-ME-04 → S-ME-06,
 * REQ-AUTH-08, D-131): the validation pipe with its implicit conversion, the
 * conditional write of a time zone change, and the 429 the error filter makes
 * of a change within 24 hours.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Settings over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const EMAIL = `itest-settings-${randomUUID()}@example.test`

    let app: NestExpressApplication
    let accessToken: string
    let userId: string

    const api = () => request(app.getHttpServer())
    const signedIn = (req: request.Test) =>
        req.set('Authorization', `Bearer ${accessToken}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const settings = async () => (await signedIn(api().get('/api/v1/users/me/settings'))).body.data
    const patch = (body: object) => signedIn(api().patch('/api/v1/users/me/settings')).send(body)
    const typeOf = (res: request.Response) => [res.status, res.body.meta.type]

    beforeAll(async () => {
        app = await bootApp()
        accessToken = (await signInWithCode(post, EMAIL)).accessToken
        await completeAccount(post, accessToken, 'Meadow-Copper-37')
        userId = (await signedIn(api().get('/api/v1/users/me'))).body.data.id
    })

    afterAll(async () => {
        await app
            ?.get(PrismaService)
            .user.deleteMany({ where: { email: { startsWith: 'itest-settings-' } } })
            .catch(() => undefined)
        await closeApp(app)
    })

    it('starts from what the account was completed with, and the defaults', async () => {
        expect(await settings()).toEqual({
            timezone: 'Asia/Ho_Chi_Minh',
            timezone_changeable_at: null,
            language: 'en',
            theme: 'system',
            phase_sound: true,
            browser_notifications: false,
            notify_mentions: true,
            notify_direct_messages: true,
            notify_incoming_calls: true,
            notify_phase_changes: true,
            notification_prompt_dismissed: false,
            allow_server_member_messages: true,
            show_study_activity: true
        })
    })

    it('keeps a choice for the next browser to read', async () => {
        const saved = await patch({ theme: 'dark', language: 'vi', phase_sound: false })
        expect(saved.status).toBe(200)
        expect(saved.body.data).toMatchObject({ theme: 'dark', language: 'vi', phase_sound: false })

        expect(await settings()).toMatchObject({ theme: 'dark', language: 'vi', phase_sound: false })
    })

    it('refuses values it does not know, and a switch sent as a string', async () => {
        expect(typeOf(await patch({ theme: 'sepia' }))).toEqual([422, 'VALIDATION_ERROR'])
        expect(typeOf(await patch({ timezone: '+07:00' }))).toEqual([422, 'VALIDATION_ERROR'])
        expect(typeOf(await patch({ show_study_activity: 'false' }))).toEqual([422, 'VALIDATION_ERROR'])
        expect(typeOf(await patch({ phase_sound: null }))).toEqual([422, 'VALIDATION_ERROR'])
        expect((await settings()).show_study_activity).toBe(true)
    })

    it('changes the zone once, then answers 429 with when it may change again', async () => {
        const changed = await patch({ timezone: 'Asia/Tokyo' })
        expect(changed.status).toBe(200)
        const changeableAt = changed.body.data.timezone_changeable_at
        expect(Date.parse(changeableAt) - Date.now()).toBeGreaterThan(23.9 * 60 * 60 * 1000)

        const again = await patch({ timezone: 'Europe/Paris' })
        expect(typeOf(again)).toEqual([429, 'RATE_LIMIT_EXCEEDED'])
        expect(again.body.data).toMatchObject({ reason: 'timezone', changeable_at: changeableAt })
        expect(Number(again.headers['retry-after'])).toBeGreaterThan(23 * 60 * 60)

        // The zone already in use is no change.
        expect((await patch({ timezone: 'Asia/Tokyo' })).status).toBe(200)
        expect((await settings()).timezone).toBe('Asia/Tokyo')
    })

    it('lets one of two simultaneous zone changes through, from two tabs', async () => {
        await app.get(PrismaService).userSettings.update({ where: { userId }, data: { timezoneChangedAt: null } })

        const answers = await Promise.all([patch({ timezone: 'Europe/Paris' }), patch({ timezone: 'America/Lima' })])

        expect(answers.map((answer) => answer.status).sort()).toEqual([200, 429])
        const winner = answers.find((answer) => answer.status === 200)?.body.data.timezone
        expect((await settings()).timezone).toBe(winner)
    })
})
