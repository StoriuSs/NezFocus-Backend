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
})
