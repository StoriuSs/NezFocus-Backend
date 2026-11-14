import { ConfigService } from '@nestjs/config'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
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
        HeadObjectCommand: Command,
        CopyObjectCommand: Command
    }
})
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }))
jest.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: jest.fn() }))

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

    describe('uploads straight from the browser and reading back what came', () => {
        const make = () => {
            const service = new S3StorageService({ get: (key: string) => settings[key] } as unknown as ConfigService)
            const send = (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send
            return { service, send }
        }
        const notFound = Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })

        it('gives a form whose policy keeps the size limit at the storage, for that one key', async () => {
            const { service } = make()
            jest.mocked(createPresignedPost).mockResolvedValue({ url: 'https://s3/avatars', fields: { key: 'a/1' } })

            const form = await service.createUploadForm('attachments/1', { maxBytes: 100, expiresIn: 900 })

            expect(form).toEqual({ url: 'https://s3/avatars', fields: { key: 'a/1' } })
            expect(jest.mocked(createPresignedPost).mock.calls[0][1]).toEqual({
                Bucket: 'avatars',
                Key: 'attachments/1',
                Conditions: [['content-length-range', 1, 100]],
                Expires: 900
            })
        })

        it('reads the size kept, and null for no such file; any other failure is thrown', async () => {
            const { service, send } = make()
            send.mockResolvedValueOnce({ ContentLength: 42 })
            expect(await service.getFileSize('attachments/1')).toBe(42)
            send.mockRejectedValueOnce(notFound)
            expect(await service.getFileSize('attachments/1')).toBeNull()
            send.mockRejectedValueOnce(new Error('connection refused'))
            await expect(service.getFileSize('attachments/1')).rejects.toThrow()
        })

        it('reads only the bytes asked for; an empty file has none, a missing one is not found', async () => {
            const { service, send } = make()
            send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
            expect([...(await service.getFileRange('attachments/1', 0, 2))]).toEqual([1, 2, 3])
            expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'avatars', Key: 'attachments/1', Range: 'bytes=0-2' })

            send.mockRejectedValueOnce(
                Object.assign(new Error('InvalidRange'), { name: 'InvalidRange', $metadata: { httpStatusCode: 416 } })
            )
            expect((await service.getFileRange('attachments/1', 0, 2)).length).toBe(0)

            send.mockRejectedValueOnce(notFound)
            await expect(service.getFileRange('attachments/1', 0, 2)).rejects.toMatchObject({ status: 404 })
        })

        it('copies a file to another key, in the same bucket', async () => {
            const { service, send } = make()
            send.mockResolvedValueOnce({})
            await service.copyFile('uploads/1', 'attachments/1')
            expect(send.mock.calls[0][0].input).toEqual({
                Bucket: 'avatars',
                CopySource: 'avatars/uploads/1',
                Key: 'attachments/1'
            })
            send.mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }))
            await expect(service.copyFile('uploads/2', 'attachments/2')).rejects.toMatchObject({ status: 404 })
        })

        it('signs a link that answers with the type and disposition asked for', async () => {
            const { service } = make()
            jest.mocked(getSignedUrl).mockResolvedValue('https://signed')
            await service.getSignedReadUrl('attachments/1', {
                responseContentType: 'text/plain; charset=utf-8',
                responseContentDisposition: 'attachment'
            })
            expect((jest.mocked(getSignedUrl).mock.calls[0][1] as unknown as { input: object }).input).toEqual({
                Bucket: 'avatars',
                Key: 'attachments/1',
                ResponseContentType: 'text/plain; charset=utf-8',
                ResponseContentDisposition: 'attachment'
            })
        })
    })
})
