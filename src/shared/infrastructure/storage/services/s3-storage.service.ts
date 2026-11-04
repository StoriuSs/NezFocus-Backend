import { Injectable, HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { extensionFor } from './file-extension'
import { CustomException } from '@/shared/presentation/exceptions'
import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants'
import { MESSAGES } from '@/shared/constants'
import { IStorageService, UploadedFile, UploadOptions, SignedUrlOptions } from '../interfaces/storage.interface'

@Injectable()
export class S3StorageService implements IStorageService {
    private s3Client: S3Client
    /** Signs URLs for browsers; bound to the public endpoint (see constructor). */
    private presignClient: S3Client
    private bucket: string
    private region: string
    private maxFileSize: number
    private allowedFileTypes: string[]
    private publicEndpoint?: string

    constructor(private readonly configService: ConfigService) {
        this.region = this.configService.get<string>('upload.s3.region')!
        this.bucket = this.configService.get<string>('upload.s3.bucket')!
        this.maxFileSize = this.configService.get<number>('upload.maxFileSize') || 5 * 1024 * 1024
        this.allowedFileTypes = this.configService.get<string[]>('upload.allowedFileTypes') || [
            'image/jpeg',
            'image/png',
            'image/jpg',
            'image/webp'
        ]

        // An explicit endpoint points the client at an S3-compatible server
        // (RustFS, MinIO, LocalStack, R2, Spaces) instead of AWS. Those servers cannot
        // serve bucket-as-subdomain, so path-style addressing goes with it.
        const endpoint = this.configService.get<string>('upload.s3.endpoint')
        const forcePathStyle = this.configService.get<boolean>('upload.s3.forcePathStyle')

        // The address the app uses to reach storage is not always the address
        // a browser can use. With the app and RustFS in one Docker network, the
        // app uploads to http://rustfs:9000, but a browser can only open
        // http://localhost:9100. A presigned URL cannot be rewritten after the
        // fact — the host is part of the signature — so links are signed by a
        // second client bound to the public endpoint. Signing is local crypto;
        // this client never makes a request.
        this.publicEndpoint = this.configService.get<string>('upload.s3.publicEndpoint') ?? endpoint

        const clientConfig = (clientEndpoint?: string) => ({
            region: this.region,
            credentials: {
                accessKeyId: this.configService.get<string>('upload.s3.accessKeyId')!,
                secretAccessKey: this.configService.get<string>('upload.s3.secretAccessKey')!
            },
            ...(clientEndpoint ? { endpoint: clientEndpoint } : {}),
            // Since 3.729 the SDK adds a CRC32 checksum to every upload. AWS
            // accepts it; S3-compatible stores (R2, B2, older MinIO) have
            // refused it, so with an endpoint set it is sent only where the
            // API requires one.
            ...(endpoint
                ? {
                      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
                      responseChecksumValidation: 'WHEN_REQUIRED' as const
                  }
                : {}),
            ...(forcePathStyle ? { forcePathStyle: true } : {}),
            // The SDK's defaults are no connection timeout and no request
            // timeout: a stalled storage endpoint held an upload request open
            // indefinitely. Uploads are at most a few MB.
            requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 }
        })

        this.s3Client = new S3Client(clientConfig(endpoint))
        this.presignClient =
            this.publicEndpoint === endpoint ? this.s3Client : new S3Client(clientConfig(this.publicEndpoint))
    }

    /**
     * A readable reason for a failed S3 call. Connection failures from the SDK
     * (refused, DNS, timeout) often carry an empty `message` — an AggregateError
     * with the reason in `code` — which used to produce "Failed to upload
     * buffer to S3: " with nothing after the colon.
     *
     * It goes in the exception's `cause`, which the log and error tracking
     * show, not in its message, which is the answer's: an SDK's text can name
     * the storage's internal address.
     */
    private describeError(error: unknown): string {
        const e = error as { message?: string; code?: string; name?: string; errors?: Array<{ message?: string }> }
        return (
            e.message ||
            e.errors
                ?.map((inner) => inner.message)
                .filter(Boolean)
                .join('; ') ||
            e.code ||
            e.name ||
            'unknown error'
        )
    }

    async uploadFile(file: Express.Multer.File, options?: UploadOptions): Promise<UploadedFile> {
        const maxSize = options?.maxFileSize || this.maxFileSize
        const allowedTypes = options?.allowedMimeTypes || this.allowedFileTypes
        const subDir = options?.subDirectory || ''
        const prefix = options?.filenamePrefix || ''

        // Validate file size
        if (file.size > maxSize) {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_FILE_TOO_LARGE,
                type: ERROR_TYPES.UPLOAD_FILE_TOO_LARGE,
                message: MESSAGES.UPLOAD.FILE_TOO_LARGE,
                status: HttpStatus.PAYLOAD_TOO_LARGE
            })
        }

        // Validate file type
        if (!allowedTypes.includes(file.mimetype)) {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_INVALID_TYPE,
                type: ERROR_TYPES.UPLOAD_INVALID_TYPE,
                message: MESSAGES.UPLOAD.INVALID_FILE_TYPE,
                status: HttpStatus.UNSUPPORTED_MEDIA_TYPE
            })
        }

        // Generate unique filename
        // From the checked type, not the client's filename (see extensionFor).
        const fileExtension = extensionFor(file.mimetype)
        const uniqueSuffix = `${Date.now()}-${randomUUID().split('-')[0]}`
        const filename = prefix ? `${prefix}-${uniqueSuffix}.${fileExtension}` : `${uniqueSuffix}.${fileExtension}`

        // Build S3 key (path)
        const s3Key = subDir ? `${subDir}/${filename}` : filename

        try {
            // Get file buffer
            const fileBuffer = file.buffer || (await this.readFileFromPath(file.path))

            // Upload to S3
            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: s3Key,
                Body: fileBuffer,
                ContentType: file.mimetype
            })

            await this.s3Client.send(command)

            const url = this.getPublicUrl(s3Key)

            return {
                filename,
                originalName: file.originalname,
                path: s3Key,
                size: file.size,
                mimetype: file.mimetype,
                url,
                key: s3Key
            }
        } catch (error) {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_FAILED,
                type: ERROR_TYPES.UPLOAD_FAILED,
                message: MESSAGES.UPLOAD.FAILED,
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                cause: new Error(`Failed to upload file to S3: ${this.describeError(error)}`)
            })
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        try {
            // Handle both full URL and key path
            const s3Key = this.extractS3Key(filePath)

            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: s3Key
            })

            await this.s3Client.send(command)
        } catch (error) {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_DELETE_FAILED,
                type: ERROR_TYPES.UPLOAD_DELETE_FAILED,
                message: MESSAGES.UPLOAD.DELETE_FAILED,
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                cause: new Error(`Failed to delete file from S3: ${this.describeError(error)}`)
            })
        }
    }

    async getFile(filePath: string): Promise<Buffer> {
        try {
            const s3Key = this.extractS3Key(filePath)

            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: s3Key
            })

            const response = await this.s3Client.send(command)
            const stream = response.Body as NodeJS.ReadableStream

            return this.streamToBuffer(stream)
        } catch {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_FILE_NOT_FOUND,
                type: ERROR_TYPES.UPLOAD_FILE_NOT_FOUND,
                message: `File not found in S3: ${filePath}`,
                status: HttpStatus.NOT_FOUND
            })
        }
    }

    /**
     * Extract S3 key from full URL or path
     * Handles:
     * - Full URL: https://bucket.s3.region.amazonaws.com/path/file.jpg → path/file.jpg
     * - Key path: path/file.jpg → path/file.jpg
     */
    private extractS3Key(filePath: string): string {
        if (filePath.includes('amazonaws.com/')) {
            return filePath.split('amazonaws.com/')[1]
        }
        return filePath
    }

    private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
        const chunks: Buffer[] = []
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk))
        }
        return Buffer.concat(chunks)
    }

    private async readFileFromPath(filePath: string): Promise<Buffer> {
        const { promises: fs } = await import('fs')
        return fs.readFile(filePath)
    }

    async uploadBuffer(
        buffer: Buffer,
        filename: string,
        mimetype: string,
        options?: Omit<UploadOptions, 'allowedMimeTypes' | 'maxFileSize'>
    ): Promise<UploadedFile> {
        const subDir = options?.subDirectory || ''
        const prefix = options?.filenamePrefix || ''

        // Generate unique filename
        const fileExtension = filename.split('.').pop() || 'bin'
        const uniqueSuffix = `${Date.now()}-${randomUUID().split('-')[0]}`
        const finalFilename = prefix ? `${prefix}-${uniqueSuffix}.${fileExtension}` : `${uniqueSuffix}.${fileExtension}`

        // Build S3 key
        const s3Key = subDir ? `${subDir}/${finalFilename}` : finalFilename

        try {
            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: s3Key,
                Body: buffer,
                ContentType: mimetype
            })

            await this.s3Client.send(command)

            const url = this.getPublicUrl(s3Key)

            return {
                filename: finalFilename,
                originalName: filename,
                path: s3Key,
                size: buffer.length,
                mimetype,
                url,
                key: s3Key
            }
        } catch (error) {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_FAILED,
                type: ERROR_TYPES.UPLOAD_FAILED,
                message: MESSAGES.UPLOAD.FAILED,
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                cause: new Error(`Failed to upload buffer to S3: ${this.describeError(error)}`)
            })
        }
    }

    async fileExists(filePath: string): Promise<boolean> {
        try {
            const s3Key = this.extractS3Key(filePath)
            const command = new HeadObjectCommand({
                Bucket: this.bucket,
                Key: s3Key
            })
            await this.s3Client.send(command)
            return true
        } catch {
            return false
        }
    }

    /**
     * Generate the public URL for a file.
     *
     * NOTE: this URL only works if the bucket policy grants `s3:GetObject`
     * to anonymous requests. For private buckets (the secure default),
     * prefer `getSignedReadUrl` instead.
     */
    getPublicUrl(s3Key: string): string {
        const key = this.extractS3Key(s3Key)

        // A custom endpoint means an S3-compatible server, which addresses
        // objects path-style. Hardcoding the AWS virtual-host format here
        // would produce URLs that do not resolve against RustFS, R2 or Spaces.
        if (this.publicEndpoint) {
            return `${this.publicEndpoint.replace(/\/$/, '')}/${this.bucket}/${key}`
        }

        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`
    }

    /**
     * Generate a time-limited signed URL for reading a private S3 object.
     *
     * The signature is pure local crypto — no API call to S3 — so this is
     * cheap to call inline on every response.
     *
     * Default TTL is 1 hour. AWS v4 signatures cap at 7 days.
     *
     * `responseContentDisposition` forces the browser to download instead
     * of inline-render, e.g. `attachment; filename="delivery.zip"`. The
     * S3 object's stored metadata is unchanged; the disposition only
     * applies to responses fetched via this exact signed URL.
     */
    async getSignedReadUrl(filePath: string, options?: SignedUrlOptions): Promise<string> {
        const s3Key = this.extractS3Key(filePath)
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: s3Key,
            ResponseContentDisposition: options?.responseContentDisposition
        })
        return getSignedUrl(this.presignClient, command, {
            expiresIn: options?.expiresIn ?? 3600
        })
    }
}
