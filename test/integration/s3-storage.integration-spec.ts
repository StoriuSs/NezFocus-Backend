import { Test, TestingModule } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { S3StorageService } from '@/shared/infrastructure/storage/services/s3-storage.service'
import uploadConfig from '@/config/upload.config'
import { s3Target } from './targets'

/**
 * Exercises the S3 storage path against a real S3-compatible server (RustFS).
 *
 * This suite exists because of a bug that was invisible without it: every
 * avatar URL in every API response was produced by `getPublicUrl`, while
 * `getSignedReadUrl` — the one that works against a private bucket — was
 * unreachable from the users module. Against the private bucket the code
 * documents as its secure default, every avatar URL returned 403.
 *
 * It was also impossible to catch locally, because S3Client was constructed
 * with no endpoint override, so the S3 code path could only ever run against a
 * live AWS bucket.
 *
 * Requires RustFS: `pnpm test:services:up`, then `pnpm test:integration`.
 */
const { endpoint: ENDPOINT, bucket: BUCKET, accessKey: ACCESS_KEY, secretKey: SECRET_KEY } = s3Target

describe('S3StorageService (integration)', () => {
    let moduleRef: TestingModule
    let storage: S3StorageService
    // Every object this suite uploads, so teardown can remove them. Without
    // it each run left its test PNGs behind in the bucket.
    const createdKeys: string[] = []

    // A 1x1 PNG — small enough to inline, real enough for sharp and S3.
    const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
    )

    beforeAll(async () => {
        process.env.STORAGE_TYPE = 's3'
        process.env.AWS_REGION = 'us-east-1'
        process.env.AWS_S3_BUCKET = BUCKET
        process.env.AWS_ACCESS_KEY_ID = ACCESS_KEY
        process.env.AWS_SECRET_ACCESS_KEY = SECRET_KEY
        process.env.AWS_S3_ENDPOINT = ENDPOINT
        process.env.AWS_S3_FORCE_PATH_STYLE = 'true'

        // Buckets are private by default in S3 servers, which is what we want to test.
        const admin = new S3Client({
            region: 'us-east-1',
            endpoint: ENDPOINT,
            forcePathStyle: true,
            credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY }
        })
        try {
            await admin.send(new CreateBucketCommand({ Bucket: BUCKET }))
        } catch (error) {
            // BucketAlreadyOwnedByYou on a re-run
            if ((error as Error).name !== 'BucketAlreadyOwnedByYou') throw error
        }
        admin.destroy()

        moduleRef = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, load: [uploadConfig] })],
            providers: [S3StorageService]
        }).compile()

        storage = moduleRef.get(S3StorageService)
    })

    afterAll(async () => {
        await Promise.all(createdKeys.map((key) => storage.deleteFile(key)))
        await moduleRef?.close()
    })

    it('stores a file in the private bucket: an unsigned URL is refused, a signed one works', async () => {
        const uploaded = await storage.uploadBuffer(pngBuffer, 'avatar.png', 'image/png', { subDirectory: 'avatars' })
        createdKeys.push(uploaded.key)

        // The regression: the API used to hand clients this URL.
        expect((await fetch(storage.getPublicUrl(uploaded.key))).status).toBe(403)

        const signed = await storage.getSignedReadUrl(uploaded.key, { expiresIn: 300 })
        const response = await fetch(signed)
        expect(response.status).toBe(200)
        expect(Buffer.from(await response.arrayBuffer()).length).toBe(pngBuffer.length)
    })

    describe('uploads straight from the browser (D-165)', () => {
        /** Posts `bytes` with the form, as a browser does: the fields, then the file. */
        async function postWith(form: { url: string; fields: Record<string, string> }, bytes: Uint8Array<ArrayBuffer>) {
            const body = new FormData()
            for (const [name, value] of Object.entries(form.fields)) body.append(name, value)
            body.append('file', new Blob([bytes]))
            return fetch(form.url, { method: 'POST', body })
        }

        it('takes a file within the size the form allows, and refuses one over it at the storage', async () => {
            const key = `attachments/itest-${Date.now()}`
            createdKeys.push(key)
            const form = await storage.createUploadForm(key, { maxBytes: 1000, expiresIn: 60 })

            expect((await postWith(form, new Uint8Array(2000))).status).toBe(400)
            expect(await storage.getFileSize(key)).toBeNull()

            expect((await postWith(form, new Uint8Array([1, 2, 3, 4, 5]))).status).toBe(204)
            expect(await storage.getFileSize(key)).toBe(5)
        })

        it('reads only the bytes asked for, fewer at the end of the file, and none past it', async () => {
            const key = `attachments/itest-range-${Date.now()}`
            createdKeys.push(key)
            await postWith(
                await storage.createUploadForm(key, { maxBytes: 1000, expiresIn: 60 }),
                new Uint8Array([9, 8, 7, 6])
            )

            expect([...(await storage.getFileRange(key, 1, 2))]).toEqual([8, 7])
            expect([...(await storage.getFileRange(key, 2, 4095))]).toEqual([7, 6])
            await expect(storage.getFileRange('attachments/none', 0, 10)).rejects.toMatchObject({ status: 404 })
        })

        it('copies a file within the bucket, so posting with the form again never reaches the copy', async () => {
            const from = `uploads/itest-copy-${Date.now()}`
            const to = `attachments/itest-copy-${Date.now()}`
            createdKeys.push(from, to)
            const form = await storage.createUploadForm(from, { maxBytes: 1000, expiresIn: 60 })
            await postWith(form, new Uint8Array([1, 2, 3]))

            await storage.copyFile(from, to)
            await postWith(form, new Uint8Array([9, 9, 9, 9]))

            expect([...(await storage.getFileRange(to, 0, 10))]).toEqual([1, 2, 3])
            await expect(storage.copyFile('uploads/none', to)).rejects.toMatchObject({ status: 404 })
        })

        it('signs a link that answers with the type and disposition asked for, whatever was uploaded', async () => {
            const key = `attachments/itest-link-${Date.now()}`
            createdKeys.push(key)
            await postWith(
                await storage.createUploadForm(key, { maxBytes: 1000, expiresIn: 60 }),
                new TextEncoder().encode('<b>hi</b>')
            )

            const res = await fetch(
                await storage.getSignedReadUrl(key, {
                    responseContentType: 'text/plain; charset=utf-8',
                    responseContentDisposition: `attachment; filename="a.html"`
                })
            )

            expect(res.status).toBe(200)
            expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
            expect(res.headers.get('content-disposition')).toBe('attachment; filename="a.html"')
        })
    })
})
