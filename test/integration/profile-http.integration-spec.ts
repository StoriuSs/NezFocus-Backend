import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import sharp from 'sharp'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * The profile page's requests through the whole app (S-ME-02, REQ-AUTH-06,
 * D-72, D-139): the validation pipe, multer's limit, the error filter and
 * sharp's look at the bytes, which the unit suites only see one at a time.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Profile over HTTP (integration)', () => {
    const CLIENT_IP = testClientIp()
    const EMAIL = `itest-profile-${randomUUID()}@example.test`

    let app: NestExpressApplication
    let accessToken: string

    const api = () => request(app.getHttpServer())
    const signedIn = (req: request.Test) =>
        req.set('Authorization', `Bearer ${accessToken}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = api().post(`/api/v1/${path}`).set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const patchProfile = (body: object) =>
        signedIn(api().patch('/api/v1/users/me')).set('Idempotency-Key', randomUUID()).send(body)
    const upload = (file: Buffer, contentType: string) =>
        signedIn(api().post('/api/v1/users/me/avatar'))
            .set('Idempotency-Key', randomUUID())
            .attach('avatar', file, { filename: 'avatar', contentType })
    const me = async () => (await signedIn(api().get('/api/v1/users/me'))).body.data
    const typeOf = (res: request.Response) => [res.status, res.body.meta.type]
    const picture = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#3a7' } })

    beforeAll(async () => {
        app = await bootApp()
        accessToken = (await signInWithCode(post, EMAIL)).accessToken
        await completeAccount(post, accessToken, 'Harbour-Lantern-42')
    })

    afterAll(async () => {
        await app
            ?.get(PrismaService)
            .user.deleteMany({ where: { email: { startsWith: 'itest-profile-' } } })
            .catch(() => undefined)
        await closeApp(app)
    })

    it('stores a name composed, counting characters: 32 Vietnamese letters typed decomposed, or 32 emoji', async () => {
        const decomposed = await patchProfile({ display_name: ` ${'ễ'.repeat(32)} ` })
        expect(decomposed.status).toBe(200)
        expect(decomposed.body.data.display_name).toBe('ễ'.repeat(32))

        const emoji = await patchProfile({ display_name: '🙂'.repeat(32), bio: '🙂'.repeat(200) })
        expect(emoji.status).toBe(200)
        expect(await me()).toMatchObject({ display_name: '🙂'.repeat(32), bio: '🙂'.repeat(200) })
    })

    it('refuses a name that would look empty, or blank it with null, and keeps the one it has', async () => {
        await patchProfile({ display_name: 'Ada' })
        for (const display_name of ['ㅤㅤ', '​', 'Ada\nLovelace', null, 'a'.repeat(33)]) {
            expect(typeOf(await patchProfile({ display_name }))).toEqual([422, 'VALIDATION_ERROR'])
        }
        expect(typeOf(await patchProfile({ bio: 'a'.repeat(201) }))).toEqual([422, 'VALIDATION_ERROR'])
        expect((await me()).display_name).toBe('Ada')
    })

    it('takes a JPG, PNG or WEBP avatar and removes it again; removing twice answers the same', async () => {
        const uploaded = await upload(await picture().png().toBuffer(), 'image/png')
        expect(uploaded.status).toBe(200)
        expect((await me()).avatar_url).toEqual(expect.any(String))

        const removed = await signedIn(api().delete('/api/v1/users/me/avatar'))
        expect(removed.status).toBe(200)
        expect((await me()).avatar_url).toBeNull()
        expect((await signedIn(api().delete('/api/v1/users/me/avatar'))).status).toBe(200)
    })

    it('refuses a GIF, by its declared type or by what its bytes really are', async () => {
        const gif = await picture().gif().toBuffer()
        expect(typeOf(await upload(gif, 'image/gif'))).toEqual([415, 'UPLOAD_INVALID_TYPE'])
        expect(typeOf(await upload(gif, 'image/png'))).toEqual([415, 'UPLOAD_INVALID_TYPE'])
    })

    it('refuses a file over 8 MB with the error the page names', async () => {
        const tooLarge = Buffer.alloc(8 * 1024 * 1024 + 1)
        expect(typeOf(await upload(tooLarge, 'image/png'))).toEqual([413, 'UPLOAD_FILE_TOO_LARGE'])
    })
})
