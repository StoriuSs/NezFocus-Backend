import './load-env' // UPLOAD_LIMITS is read at import time, before ConfigModule
import { registerAs } from '@nestjs/config'
import { parseBooleanEnv, parseIntSafe } from '@/shared/utils'

/**
 * Upload limits.
 *
 * Exported as plain constants as well as config because route decorators
 * (`FileInterceptor`, `ParseFilePipe`) are evaluated at class-definition time,
 * before any ConfigService exists. Keeping one source of truth here stops the
 * decorator limits and the service-layer checks from drifting apart — which is
 * how MAX_FILE_SIZE and ALLOWED_FILE_TYPES ended up being dead config on the
 * only upload route in the app.
 */
export const UPLOAD_LIMITS = {
    /** Hard ceiling accepted by multer before anything is buffered. */
    maxFileSizeBytes: parseIntSafe(process.env.MAX_FILE_SIZE, 5242880), // 5MB

    /**
     * Raster formats only. SVG is deliberately excluded: it is XML, sharp
     * rasterises it through librsvg, and a nested-entity document is a cheap
     * way to burn memory and CPU.
     */
    allowedImageMimeTypes: ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'],

    /**
     * Decoded-pixel ceiling. A file can be small on disk and enormous once
     * decoded — sharp's own default allows ~268MP, roughly 1GB of RSS for a
     * single decode. 40MP covers any legitimate photo upload.
     */
    maxPixels: parseIntSafe(process.env.MAX_IMAGE_PIXELS, 40_000_000),

    /**
     * Time limit for a single sharp pipeline (rounded up to whole seconds), and
     * also the longest an image waits for a processing slot: an upload can spend
     * about twice this in image processing. REQUEST_TIMEOUT_MS counts from the
     * start of the request, body upload included, so keep it above twice this;
     * otherwise a slow upload gets 408 while its image is still processed.
     */
    imageProcessingTimeoutMs: parseIntSafe(process.env.IMAGE_PROCESSING_TIMEOUT_MS, 15000),

    /**
     * Images processed at the same time, per app instance. An image that can't
     * be shrunk while decoding (an interlaced PNG) takes ~4 bytes per pixel:
     * ~150MB at the default MAX_IMAGE_PIXELS, on top of the app's own ~140MB.
     * Two fit the prod container's 512MB; raise the memory limit with it. Keep
     * it below 4, libuv's thread pool, which file reads and DNS lookups share.
     */
    imageProcessingConcurrency: parseIntSafe(process.env.IMAGE_PROCESSING_CONCURRENCY, 2),

    /**
     * Images allowed to wait for a slot. Each holds its upload in memory while
     * it waits; beyond this, uploads are refused with 503 straight away.
     */
    imageProcessingQueueLimit: parseIntSafe(process.env.IMAGE_PROCESSING_QUEUE_LIMIT, 10)
} as const

export default registerAs('upload', () => ({
    storageType: process.env.STORAGE_TYPE || 'local',
    maxFileSize: UPLOAD_LIMITS.maxFileSizeBytes,
    allowedFileTypes: UPLOAD_LIMITS.allowedImageMimeTypes,
    local: {
        // UPLOAD_DEST is the name used by every .env file and by the Joi
        // schema. The config previously read LOCAL_UPLOAD_DIR, which nothing
        // sets — so a configured upload directory was silently ignored and
        // files always landed in ./uploads relative to the working directory
        // (lost on every container redeploy, even with a volume mounted).
        uploadDir: process.env.UPLOAD_DEST || './uploads'
    },
    s3: {
        region: process.env.AWS_REGION || 'us-east-1',
        bucket: process.env.AWS_S3_BUCKET || '',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',

        // Custom endpoint for S3-compatible storage (RustFS, MinIO, LocalStack,
        // Cloudflare R2, DigitalOcean Spaces). Leave unset for real AWS S3.
        //
        // Without this the storage layer can only ever be exercised against a
        // live AWS bucket, which means the S3 code path — including presigned
        // URL generation — goes untested locally and in CI.
        endpoint: process.env.AWS_S3_ENDPOINT || undefined,

        // The endpoint browsers use, when it differs from the one the app
        // uses — e.g. the app reaches RustFS as http://rustfs:9000 inside Docker
        // but the browser opens http://localhost:9100. Used for public and
        // presigned URLs. Defaults to `endpoint`.
        publicEndpoint: process.env.AWS_S3_PUBLIC_ENDPOINT || undefined,

        // Path-style addressing (http://host/bucket/key) instead of
        // virtual-host style (http://bucket.host/key). Required by RustFS, MinIO and
        // most S3-compatible servers, which cannot do bucket-as-subdomain.
        // Defaults to true whenever a custom endpoint is set.
        forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE
            ? parseBooleanEnv(process.env.AWS_S3_FORCE_PATH_STYLE)
            : Boolean(process.env.AWS_S3_ENDPOINT)
    }
}))
