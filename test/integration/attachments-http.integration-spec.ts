import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import { CommandBus } from '@nestjs/cqrs'
import request from 'supertest'
import { CleanUpAttachmentsCommand } from '@/modules/messaging'
import {
    ATTACHMENT_STORAGE,
    AttachmentStoragePort,
    FILE_CLEANUP,
    FileCleanupPort,
    SEND_LIMIT,
    SendLimitPort
} from '@/modules/messaging/application'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const HOUR = 60 * 60 * 1000

/**
 * The storage, in memory: the browser's upload is a `put` here. The real one
 * (S3 presigned POST, ranges, sizes) is tested against RustFS in
 * s3-storage.integration-spec.ts, which runs apart (it needs vm-modules).
 */
class MemoryStorage implements AttachmentStoragePort {
    readonly files = new Map<string, Uint8Array>()
    put = (key: string, bytes: number[] | Uint8Array) => this.files.set(key, new Uint8Array(bytes))
    uploadForm = async (key: string) => ({
        url: 'https://storage.test/bucket',
        fields: { key, Policy: 'eyJ...', 'X-Amz-Signature': 'abc' }
    })
    sizeOf = async (key: string) => this.files.get(key)?.length ?? null
    copy = async (from: string, to: string) => {
        const bytes = this.files.get(from)
        if (bytes) this.files.set(to, bytes)
        return bytes !== undefined
    }
    read = async (key: string, start: number, end: number) => this.files.get(key)!.subarray(start, end + 1)
    thumbnail = async (attachmentId: string, bytes: Uint8Array) =>
        PNG.every((byte, i) => bytes[i] === byte)
            ? { key: `attachments/thumb-${attachmentId}.webp`, width: 1600, height: 900 }
            : ('other-type' as const)
    readLink = async (key: string, options: { contentType: string; contentDisposition: string }) =>
        `https://storage.test/${key}?type=${encodeURIComponent(options.contentType)}&disposition=${encodeURIComponent(options.contentDisposition)}`
    delete = async (key: string) => void this.files.delete(key)
}

/**
 * Files in messages through the whole app (REQ-MSG-04, D-93, D-165): the
 * form to upload one, the check of what arrived, sending files in a message
 * (once, by their uploader, ATTACH_FILES), reading them back with their
 * links, and the clean-up of files no message holds.
 *
 * Requires Postgres, Redis and Mailpit: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Attachments (integration)', () => {
    const CLIENT_IP = testClientIp()
    const PREFIX = `itest-att-${randomUUID().slice(0, 8)}`
    const PASSWORD = 'Harbour-Lantern-42'
    type Who = 'an' | 'binh' | 'khanh'

    let app: NestExpressApplication
    let prisma: PrismaService
    const storage = new MemoryStorage()
    const deletedLater: string[] = []
    const cleanup: FileCleanupPort = { deleteFileLater: async (key) => void deletedLater.push(key) }
    // This suite sends faster than 5 messages in 5 seconds; the limits have their own (messaging-http).
    const unlimited: SendLimitPort = {
        hit: async () => ({ count: 1, limited: false, retryAfterSeconds: 0 }),
        release: async () => undefined
    }
    const users = {} as Record<Who, { token: string; id: string }>
    let generalId: string
    let secretId: string

    const api = () => request(app.getHttpServer())
    const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
    const as = (who: Who, req: request.Test) => anyone(req).set('Authorization', `Bearer ${users[who].token}`)
    const post = (path: string, body: object = {}, token?: string) => {
        const req = anyone(api().post(`/api/v1/${path}`))
        return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
    }
    const outcome = (res: request.Response) => [res.status, res.body.meta?.type]

    const ask = (who: Who, filename: string, size = 100, channelId = generalId) =>
        as(who, api().post('/api/v1/attachments')).send({ channel_id: channelId, filename, size })
    const complete = (who: Who, id: string) => as(who, api().post(`/api/v1/attachments/${id}/complete`))
    const links = (who: Who, id: string) => as(who, api().get(`/api/v1/attachments/${id}/url`))
    const send = (who: Who, content: string, attachmentIds: string[], nonce = randomUUID()) =>
        as(who, api().post(`/api/v1/channels/${generalId}/messages`))
            .set('Idempotency-Key', randomUUID())
            .send({ content, nonce, attachment_ids: attachmentIds })

    /** `who` uploads `bytes` as `filename` and the check passes: the file's id. */
    async function uploaded(who: Who, filename: string, bytes: number[]): Promise<string> {
        const res = await ask(who, filename, bytes.length)
        const key = res.body.data.upload.fields.find((field: { name: string }) => field.name === 'key').value
        storage.put(key, bytes)
        const done = await complete(who, res.body.data.attachment_id)
        expect(done.status).toBe(200)
        return res.body.data.attachment_id
    }

    async function signUp(who: Who) {
        const email = `${PREFIX}-${who}@example.test`
        const { accessToken } = await signInWithCode(post, email)
        await completeAccount(post, accessToken, PASSWORD)
        const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
        users[who] = { token: accessToken, id: me.body.data.id }
    }

    beforeAll(async () => {
        app = await bootApp((builder) =>
            builder
                .overrideProvider(ATTACHMENT_STORAGE)
                .useValue(storage)
                .overrideProvider(FILE_CLEANUP)
                .useValue(cleanup)
                .overrideProvider(SEND_LIMIT)
                .useValue(unlimited)
        )
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh', 'khanh'] as Who[]) await signUp(who)

        const created = await as('an', api().post('/api/v1/servers'))
            .set('Idempotency-Key', randomUUID())
            .send({ name: 'Ôn thi Giải tích 2', template: 'standard' })
        const serverId = created.body.data.id
        const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
            .set('Idempotency-Key', randomUUID())
            .send({ max_age_seconds: null, max_uses: null })
        await as('binh', api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
        const secret = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
            .set('Idempotency-Key', randomUUID())
            .send({ type: 'text', name: 'ban-can-su', is_private: true, view_role_ids: [] })
        secretId = secret.body.data.id
        const channels = await prisma.channel.findMany({
            where: { serverId },
            select: { id: true, name: true, type: true }
        })
        generalId = channels.find((channel) => channel.type === 'text' && channel.name !== 'ban-can-su')!.id
    })

    afterAll(async () => {
        const ids = Object.values(users).map((user) => user.id)
        // Attachment.uploader is Restrict: the files go before their people (schema).
        await prisma?.attachment.deleteMany({ where: { uploaderId: { in: ids } } }).catch(() => undefined)
        await prisma?.message.deleteMany({ where: { authorId: { in: ids } } }).catch(() => undefined)
        await prisma?.server.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined)
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    describe('asking for an upload (D-165)', () => {
        it('gives a form whose fields keep their names as the storage wrote them', async () => {
            const res = await ask('binh', 'cau4-1.png')

            expect(res.status).toBe(201)
            expect(res.body.data.upload.url).toBe('https://storage.test/bucket')
            expect(res.body.data.upload.fields.map((field: { name: string }) => field.name)).toEqual([
                'key',
                'Policy',
                'X-Amz-Signature'
            ])
            const row = await prisma.attachment.findUniqueOrThrow({ where: { id: res.body.data.attachment_id } })
            expect(row).toMatchObject({ uploaderId: users.binh.id, filename: 'cau4-1.png', messageId: null })
        })

        it('refuses a file over 25 MB, a type not sent, and a channel the person cannot see', async () => {
            expect(outcome(await ask('binh', 'bai-giang.mp4', 25 * 1024 * 1024 + 1))).toEqual([
                413,
                'UPLOAD_FILE_TOO_LARGE'
            ])
            expect(outcome(await ask('binh', 'setup.exe'))).toEqual([415, 'UPLOAD_INVALID_TYPE'])
            expect(outcome(await ask('binh', 'cau4.png', 100, secretId))).toEqual([404, 'NOT_FOUND_ERROR'])
            expect(outcome(await ask('khanh', 'cau4.png'))).toEqual([404, 'NOT_FOUND_ERROR'])
        })
    })

    describe('checking what arrived (D-93)', () => {
        it('keeps an image checked, with its size and thumbnail, its type from the content', async () => {
            const res = await ask('binh', 'cau4-2.png', PNG.length + 2)
            const id = res.body.data.attachment_id
            storage.put(res.body.data.upload.fields[0].value, [...PNG, 1, 2])

            const done = await complete('binh', id)

            expect(done.status).toBe(200)
            expect(done.body.data).toMatchObject({
                id,
                filename: 'cau4-2.png',
                size: 10,
                content_type: 'image/png',
                width: 1600,
                height: 900
            })
            expect(done.body.data.url).toContain('disposition=inline')
            // "Tải về" saves it, even an image or a PDF the browser would show.
            expect(done.body.data.download_url).toContain('disposition=attachment')
            expect(done.body.data.thumbnail_url).toContain(`thumb-${id}`)
        })

        it('deletes a file that is not what its name says, and says so', async () => {
            const res = await ask('binh', 'cong-thuc.png', 4)
            const id = res.body.data.attachment_id
            const key = res.body.data.upload.fields[0].value
            storage.put(key, [0x4d, 0x5a, 0x90, 0])

            expect(outcome(await complete('binh', id))).toEqual([415, 'UPLOAD_INVALID_TYPE'])
            expect(await prisma.attachment.findUnique({ where: { id } })).toBeNull()
            expect(storage.files.has(key)).toBe(false)
        })

        it('keeps what was checked when the form is used again after the check', async () => {
            const res = await ask('binh', 'de-giua-ky.pdf', 9)
            const id = res.body.data.attachment_id
            const formKey = res.body.data.upload.fields[0].value
            storage.put(formKey, [...Buffer.from('%PDF-1.7\n')])
            expect((await complete('binh', id)).status).toBe(200)

            // The form lasts 15 minutes: something else posted with it after the check.
            storage.put(formKey, [0x4d, 0x5a, 0x90, 0])

            const row = await prisma.attachment.findUniqueOrThrow({ where: { id } })
            expect(row.storageKey).not.toBe(formKey)
            expect(Buffer.from(storage.files.get(row.storageKey)!).toString()).toBe('%PDF-1.7\n')
        })

        it('answers not found while nothing arrived, and to anyone but the uploader', async () => {
            const res = await ask('binh', 'cau4-3.png')
            expect(outcome(await complete('binh', res.body.data.attachment_id))).toEqual([404, 'UPLOAD_FILE_NOT_FOUND'])
            expect(outcome(await complete('an', res.body.data.attachment_id))).toEqual([404, 'UPLOAD_FILE_NOT_FOUND'])
        })

        it('downloads text as plain text, never shown in the browser (D-177)', async () => {
            const id = await uploaded('binh', 'main.py', [...Buffer.from('print("chào")\n')])
            const res = await links('binh', id)
            expect(res.body.data.content_type).toBe('text/plain; charset=utf-8')
            expect(res.body.data.url).toContain('disposition=attachment')
            expect(res.body.data.download_url).toBe(res.body.data.url)
        })
    })

    describe('sending files (REQ-MSG-04)', () => {
        it('sends a message of files alone, in the order given, read back the same in the history', async () => {
            const first = await uploaded('binh', 'cau4-1.png', [...PNG, 1])
            const second = await uploaded('binh', 'de-giua-ky.pdf', [...Buffer.from('%PDF-1.7\n')])

            const res = await send('binh', '', [second, first])

            expect(res.status).toBe(201)
            expect(res.body.data.content).toBe('')
            expect(res.body.data.attachments.map((file: { id: string }) => file.id)).toEqual([second, first])
            const page = await as('an', api().get(`/api/v1/channels/${generalId}/messages`))
            const message = page.body.data.items.find((item: { id: string }) => item.id === res.body.data.id)
            expect(message.attachments.map((file: { filename: string }) => file.filename)).toEqual([
                'de-giua-ky.pdf',
                'cau4-1.png'
            ])
        })

        it('sends a file once: a second message with it is refused, naming it', async () => {
            const file = await uploaded('binh', 'cau4.png', [...PNG, 2])
            expect((await send('binh', 'Câu 4', [file])).status).toBe(201)

            const again = await send('binh', 'Câu 4 lần nữa', [file])

            expect(outcome(again)).toEqual([404, 'UPLOAD_FILE_NOT_FOUND'])
            expect(again.body.data).toMatchObject({ attachment_ids: [file] })
        })

        it('makes one message of two sends of the same nonce with a file, at once', async () => {
            const file = await uploaded('binh', 'cung-nonce.png', [...PNG, 9])
            const nonce = randomUUID()

            const results = await Promise.all([
                send('binh', 'Cùng nonce', [file], nonce),
                send('binh', 'Cùng nonce', [file], nonce)
            ])

            expect(results.map((res) => res.status)).toEqual([201, 201])
            expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id)
            expect(results[0]!.body.data.attachments.map((one: { id: string }) => one.id)).toEqual([file])
        })

        it('of two sends of one file at once, saves one message only', async () => {
            const file = await uploaded('binh', 'cung-luc.png', [...PNG, 3])

            const results = await Promise.all([send('binh', 'Một', [file]), send('binh', 'Hai', [file])])

            expect(results.map((res) => res.status).sort()).toEqual([201, 404])
            expect(
                await prisma.message.count({ where: { content: { in: ['Một', 'Hai'] }, channelId: generalId } })
            ).toBe(1)
        })

        it("refuses someone else's file, and a message with no text and no file", async () => {
            const anFile = await uploaded('an', 'cua-an.png', [...PNG, 4])
            expect(outcome(await send('binh', 'Của An', [anFile]))).toEqual([404, 'UPLOAD_FILE_NOT_FOUND'])
            expect(outcome(await send('binh', '   ', []))).toEqual([422, 'VALIDATION_ERROR'])
        })

        it('says how many files, and images, the message a reply answers has', async () => {
            const file = await uploaded('binh', 'anh.png', [...PNG, 5])
            const original = await send('binh', '', [file])

            const res = await as('an', api().post(`/api/v1/channels/${generalId}/messages`))
                .set('Idempotency-Key', randomUUID())
                .send({ content: 'Đẹp!', nonce: randomUUID(), reply_to_id: original.body.data.id })

            expect(res.body.data.reply_to.files).toEqual({ count: 1, images: 1 })
        })
    })

    describe('links and the clean-up', () => {
        it('gives new links to who sees the channel, and to no one once the message is deleted', async () => {
            const file = await uploaded('binh', 'link.png', [...PNG, 6])
            const message = await send('binh', '', [file])

            expect((await links('an', file)).status).toBe(200)
            expect(outcome(await links('khanh', file))).toEqual([404, 'UPLOAD_FILE_NOT_FOUND'])

            await as('binh', api().delete(`/api/v1/messages/${message.body.data.id}`))
            expect(outcome(await links('binh', file))).toEqual([404, 'UPLOAD_FILE_NOT_FOUND'])
        })

        it('removes the files of deleted messages, and those never sent once 25 hours old, not younger ones', async () => {
            const deleted = await uploaded('binh', 'xoa.png', [...PNG, 7])
            const message = await send('binh', '', [deleted])
            await as('binh', api().delete(`/api/v1/messages/${message.body.data.id}`))
            const old = await uploaded('binh', 'cu.pdf', [...Buffer.from('%PDF-1.4\n')])
            const young = await uploaded('binh', 'moi.pdf', [...Buffer.from('%PDF-1.4\n')])
            const sent = await uploaded('binh', 'da-gui.pdf', [...Buffer.from('%PDF-1.4\n')])
            await send('binh', '', [sent])
            await prisma.attachment.updateMany({
                where: { id: { in: [old, sent] } },
                data: { createdAt: new Date(Date.now() - 26 * HOUR) }
            })
            await prisma.attachment.update({
                where: { id: young },
                data: { createdAt: new Date(Date.now() - 23 * HOUR) }
            })
            const keysOf = (ids: string[]) =>
                prisma.attachment
                    .findMany({ where: { id: { in: ids } }, select: { storageKey: true, thumbnailKey: true } })
                    .then((rows) =>
                        rows.flatMap((row) => [row.storageKey, ...(row.thumbnailKey ? [row.thumbnailKey] : [])])
                    )
            const gone = await keysOf([deleted, old])
            const kept = await keysOf([young, sent])
            deletedLater.length = 0

            await app.get(CommandBus).execute(new CleanUpAttachmentsCommand(new Date()))

            const left = await prisma.attachment.findMany({ where: { id: { in: [deleted, old, young, sent] } } })
            expect(left.map((row) => row.id).sort()).toEqual([young, sent].sort())
            // Other tests' deleted messages let their files go too: only these are looked at.
            expect(deletedLater).toEqual(expect.arrayContaining(gone))
            expect(deletedLater.filter((key) => kept.includes(key))).toEqual([])
        })

        it('no longer sends a file uploaded 24 hours ago', async () => {
            const file = await uploaded('binh', 'tre.png', [...PNG, 8])
            await prisma.attachment.update({
                where: { id: file },
                data: { createdAt: new Date(Date.now() - 24 * HOUR) }
            })
            expect(outcome(await send('binh', 'Muộn', [file]))).toEqual([404, 'UPLOAD_FILE_NOT_FOUND'])
        })
    })
})
