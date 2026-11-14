import { HttpStatus } from '@nestjs/common'
import sharp from 'sharp'
import { UPLOAD_LIMITS } from '@/config/upload.config'
import { CustomException } from '@/shared/presentation/exceptions'
import { ImageProcessingService } from './image-processing.service'

describe('ImageProcessingService', () => {
    it('decodes at most IMAGE_PROCESSING_CONCURRENCY images at a time, and refuses with 503 when too many are waiting', async () => {
        const service = new ImageProcessingService()
        const input = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#3a7' } })
            .png()
            .toBuffer()
        let release!: () => void
        const blocked = new Promise<void>((resolve) => (release = resolve))
        let decoding = 0
        const decode = jest.spyOn(sharp.prototype, 'toBuffer').mockImplementation(async () => {
            decoding++
            await blocked
            return { data: Buffer.from('x'), info: { width: 1, height: 1, format: 'webp' } } as never
        })
        try {
            const capacity = UPLOAD_LIMITS.imageProcessingConcurrency + UPLOAD_LIMITS.imageProcessingQueueLimit
            const accepted = Array.from({ length: capacity }, () => service.processImage(input))
            const refused = await service.processImage(input).catch((error: unknown) => error)

            // Give every accepted upload the time to start decoding, if it were allowed to.
            for (let i = 0; i < 50 && decoding < capacity; i++) await new Promise((r) => setTimeout(r, 10))
            expect(decoding).toBe(UPLOAD_LIMITS.imageProcessingConcurrency)
            expect(refused).toBeInstanceOf(CustomException)
            expect((refused as CustomException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)

            release()
            await expect(Promise.all(accepted)).resolves.toHaveLength(capacity)
        } finally {
            decode.mockRestore()
        }
    })

    it('says how big the image given was, upright as browsers show it, besides the size it was made', async () => {
        // 400 wide, 200 high, stored on its side: orientation 6 shows it 200 wide, 400 high.
        const input = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#3a7' } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer()

        const image = await new ImageProcessingService().processImage(input, { maxWidth: 100, maxHeight: 100 })

        expect([image.sourceWidth, image.sourceHeight]).toEqual([200, 400])
        expect([image.width, image.height]).toEqual([50, 100])
    })
})
