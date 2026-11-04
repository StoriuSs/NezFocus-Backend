import { Injectable, Logger, HttpStatus } from '@nestjs/common'
import sharp from 'sharp'
import type { Metadata } from 'sharp'
import { CustomException } from '@/shared/presentation/exceptions'
import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants'
import { MESSAGES } from '@/shared/constants'
import { UPLOAD_LIMITS } from '@/config/upload.config'
import { ConcurrencyLimiter, ConcurrencyLimitError } from '@/shared/utils/concurrency-limiter.util'

export interface ProcessedImage {
    buffer: Buffer
    width: number
    height: number
    format: string
    size: number
}

export interface ImageProcessingOptions {
    /** Convert to WebP format for better compression */
    convertToWebp?: boolean
    /** Quality for lossy formats (1-100) */
    quality?: number
    /** Strip EXIF and metadata for privacy */
    stripMetadata?: boolean
    /** Maximum width - will resize if larger */
    maxWidth?: number
    /** Maximum height - will resize if larger */
    maxHeight?: number
}

/**
 * Decoded formats accepted for processing. Derived from the configured MIME
 * allowlist, and checked against what sharp actually decoded rather than the
 * client's declared Content-Type.
 */
const ALLOWED_INPUT_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'gif']

const DEFAULT_OPTIONS: ImageProcessingOptions = {
    convertToWebp: true,
    quality: 80,
    stripMetadata: true,
    maxWidth: 2048,
    maxHeight: 2048
}

// libvips keeps recently used operations and their pixel buffers (up to 50MB
// by default) to speed up repeated work on the same image. Every upload is a
// different image, so the cache only holds memory: 61MB still held after 20
// avatar uploads, against 6MB without it.
sharp.cache(false)

@Injectable()
export class ImageProcessingService {
    private readonly logger = new Logger(ImageProcessingService.name)

    /**
     * Images are processed a few at a time; the rest wait briefly or are
     * refused with 503. Measured with 12 simultaneous 36MP uploads:
     *
     * - Memory. Most images are shrunk while decoding and need little, but an
     *   interlaced PNG (121KB on disk) is decoded whole: ~150MB each. Uncapped,
     *   the app peaked at 692MB, over the prod container's 512MB, where it is
     *   killed with every request it was serving. Capped at 2: 442MB.
     * - The rest of the app. sharp runs on libuv's thread pool (4 threads),
     *   which file reads and DNS lookups share. Uncapped, those waited up to
     *   390ms behind image work; capped at 2, under 10ms.
     */
    private readonly limiter = new ConcurrencyLimiter({
        concurrency: UPLOAD_LIMITS.imageProcessingConcurrency,
        maxQueued: UPLOAD_LIMITS.imageProcessingQueueLimit,
        maxWaitMs: UPLOAD_LIMITS.imageProcessingTimeoutMs
    })

    /**
     * Process an image: resize if too large, convert to WebP, strip metadata
     */
    async processImage(input: Buffer, options: ImageProcessingOptions = {}): Promise<ProcessedImage> {
        return this.limited(() => this.process(input, { ...DEFAULT_OPTIONS, ...options }))
    }

    /** Runs sharp work within the limit; a refusal becomes 503. */
    private async limited<T>(task: () => Promise<T>): Promise<T> {
        try {
            return await this.limiter.run(task)
        } catch (error) {
            if (!(error instanceof ConcurrencyLimitError)) throw error
            this.logger.warn(
                `Image refused: ${error.message} (${this.limiter.active} processing, ${this.limiter.queued} waiting)`
            )
            throw new CustomException({
                code: ERROR_CODES.SERVICE_UNAVAILABLE,
                type: ERROR_TYPES.SERVICE_UNAVAILABLE,
                message: MESSAGES.UPLOAD.IMAGE_PROCESSING_BUSY,
                status: HttpStatus.SERVICE_UNAVAILABLE
            })
        }
    }

    private async process(input: Buffer, opts: ImageProcessingOptions): Promise<ProcessedImage> {
        try {
            // One instance, bounded.
            //
            // sharp's own default allows ~268MP, which at 4 bytes/px is roughly
            // 1GB of RSS for a single decode — a small file can be enormous once
            // decompressed. `limitInputPixels` caps that, `timeout` caps
            // wall-clock, and the explicit format allowlist keeps SVG away from
            // librsvg (it is XML, and nested entities are a cheap memory bomb).
            //
            // Previously this method built three separate sharp instances over
            // the same buffer, decoding it three times.
            const pipeline = sharp(input, {
                limitInputPixels: UPLOAD_LIMITS.maxPixels,
                failOn: 'error'
            }).timeout({ seconds: Math.ceil(UPLOAD_LIMITS.imageProcessingTimeoutMs / 1000) })

            const metadata = await pipeline.metadata()

            if (!metadata.format || !ALLOWED_INPUT_FORMATS.includes(metadata.format)) {
                throw new CustomException({
                    code: ERROR_CODES.UPLOAD_INVALID_TYPE,
                    type: ERROR_TYPES.UPLOAD_INVALID_TYPE,
                    message: MESSAGES.UPLOAD.INVALID_FILE_TYPE,
                    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE
                })
            }

            // Auto-rotate based on EXIF, then strip metadata
            if (opts.stripMetadata) {
                pipeline.rotate()
            }

            // Resize if image exceeds max dimensions
            if (opts.maxWidth || opts.maxHeight) {
                const needsResize =
                    (opts.maxWidth && metadata.width && metadata.width > opts.maxWidth) ||
                    (opts.maxHeight && metadata.height && metadata.height > opts.maxHeight)

                if (needsResize) {
                    pipeline.resize({
                        width: opts.maxWidth,
                        height: opts.maxHeight,
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                }
            }

            // Convert to WebP or optimize original format
            if (opts.convertToWebp) {
                pipeline.webp({ quality: opts.quality })
            } else if (metadata.format === 'jpeg') {
                pipeline.jpeg({ quality: opts.quality, mozjpeg: true })
            } else if (metadata.format === 'png') {
                pipeline.png({ compressionLevel: 9 })
            }

            // `toBuffer({ resolveWithObject: true })` reports the output
            // dimensions directly, so the result does not need decoding a
            // second time just to measure it.
            const { data: buffer, info } = await pipeline.toBuffer({ resolveWithObject: true })

            return {
                buffer,
                width: info.width || 0,
                height: info.height || 0,
                format: info.format || 'webp',
                size: buffer.length
            }
        } catch (error) {
            if (error instanceof CustomException) throw error
            this.logger.error(`Image processing failed: ${error.message}`)
            throw new CustomException({
                code: ERROR_CODES.IMAGE_PROCESSING_FAILED,
                type: ERROR_TYPES.IMAGE_PROCESSING_FAILED,
                message: MESSAGES.UPLOAD.IMAGE_PROCESSING_FAILED,
                status: HttpStatus.UNPROCESSABLE_ENTITY
            })
        }
    }

    /**
     * Validate if buffer is a valid image
     */
    async isValidImage(input: Buffer): Promise<boolean> {
        const metadata = await this.getMetadata(input).catch((error: unknown) => {
            if (error instanceof CustomException) throw error // busy: not a verdict on the image
            return undefined
        })
        return (
            !!metadata?.format &&
            ALLOWED_INPUT_FORMATS.includes(metadata.format) &&
            !!metadata.width &&
            !!metadata.height
        )
    }

    /**
     * Get image metadata
     */
    async getMetadata(input: Buffer): Promise<Metadata> {
        return this.limited(() =>
            sharp(input, { limitInputPixels: UPLOAD_LIMITS.maxPixels })
                .timeout({ seconds: Math.ceil(UPLOAD_LIMITS.imageProcessingTimeoutMs / 1000) })
                .metadata()
        )
    }
}
