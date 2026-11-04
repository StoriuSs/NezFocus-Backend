import { ConfigService } from '@nestjs/config'
import { S3StorageService } from './s3-storage.service'

// Keep the real SDK out of the unit suite; only the client's send() matters here.
jest.mock('@aws-sdk/client-s3', () => {
    class Command {
        constructor(readonly input: unknown) {}
    }
    return {
        S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
        PutObjectCommand: Command,
        DeleteObjectCommand: Command,
        GetObjectCommand: Command,
        HeadObjectCommand: Command
    }
})
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }))

const settings: Record<string, unknown> = {
    'upload.s3.region': 'us-east-1',
    'upload.s3.bucket': 'avatars',
    'upload.s3.accessKeyId': 'key',
    'upload.s3.secretAccessKey': 'secret'
}

describe('S3StorageService', () => {
    it("stores a file under its checked type's extension, never the client's, and anything else as .bin", async () => {
        const service = new S3StorageService({ get: (key: string) => settings[key] } as unknown as ConfigService)
        const send = (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send.mockResolvedValue({})
        const file = (mimetype: string) =>
            ({
                originalname: 'page.html',
                mimetype,
                size: 10,
                buffer: Buffer.from('<html></html>')
            }) as Express.Multer.File

        expect((await service.uploadFile(file('image/png'))).key).toMatch(/\.png$/)
        expect(send.mock.calls[0][0].input.Key).toMatch(/\.png$/)
        // A type browsers would render, in a project that allows it: stored where it never renders.
        const anyType = { allowedMimeTypes: ['text/html', 'image/svg+xml'] }
        expect((await service.uploadFile(file('text/html'), anyType)).key).toMatch(/\.bin$/)
        expect((await service.uploadFile(file('image/svg+xml'), anyType)).key).toMatch(/\.bin$/)
    })
})
