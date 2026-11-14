import sharp from 'sharp'
import { IStorageService } from '@/shared/infrastructure/storage/interfaces/storage.interface'
import { ImageProcessingService } from '@/shared/infrastructure/storage/services/image-processing.service'
import { UploadService } from '@/shared/infrastructure/storage/upload.service'
import { AttachmentStorage } from './attachment-storage.adapter'

/** The real sharp; the storage only notes what it is given. */
function adapter() {
    const stored: Array<{ name: string; mimetype: string; bytes: Buffer }> = []
    const storage = {
        uploadBuffer: jest.fn(async (bytes: Buffer, name: string, mimetype: string) => {
            stored.push({ name, mimetype, bytes })
            return {
                key: `attachments/${name}`,
                filename: name,
                originalName: name,
                path: '',
                size: bytes.length,
                mimetype,
                url: ''
            }
        })
    } as unknown as IStorageService
    return { files: new AttachmentStorage(new UploadService(storage, new ImageProcessingService())), stored }
}

describe('AttachmentStorage thumbnails (REQ-MSG-04, C-10)', () => {
    it('keeps a WebP thumbnail within 720 x 640, and the image’s own size', async () => {
        const { files, stored } = adapter()
        const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#3a7' } })
            .png()
            .toBuffer()

        const thumbnail = await files.thumbnail('f1', new Uint8Array(png), 'png')

        expect(thumbnail).toMatchObject({ width: 2000, height: 1000 })
        expect(stored[0]!.mimetype).toBe('image/webp')
        expect(await sharp(stored[0]!.bytes).metadata()).toMatchObject({ format: 'webp', width: 720, height: 360 })
    })

    it('takes the first frame of a GIF', async () => {
        const { files, stored } = adapter()
        const gif = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#3a7f' } })
            .gif()
            .toBuffer()

        expect(await files.thumbnail('f1', new Uint8Array(gif), 'gif')).toMatchObject({ width: 20, height: 10 })
        expect((await sharp(stored[0]!.bytes).metadata()).pages ?? 1).toBe(1)
    })

    it('says when the image is of another type than its name, and has no thumbnail for one that does not decode', async () => {
        const { files } = adapter()
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
            .png()
            .toBuffer()

        expect(await files.thumbnail('f1', new Uint8Array(png), 'jpeg')).toBe('other-type')
        expect(await files.thumbnail('f3', new Uint8Array(png), 'pdf')).toBe('other-type')
        // A PNG signature with nothing after it: broken, kept as a file (owner, 14/11/2026).
        expect(
            await files.thumbnail('f2', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]), 'png')
        ).toBeNull()
    })
})
