import { Injectable, Inject } from '@nestjs/common'
import {
    IStorageService,
    UploadedFile,
    UploadOptions,
    SignedUrlOptions,
    STORAGE_SERVICE
} from './interfaces/storage.interface'
import { ImageProcessingOptions, ImageProcessingService } from './services/image-processing.service'

export { UploadedFile, UploadOptions, SignedUrlOptions } from './interfaces/storage.interface'

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif']

/**
 * Reduce a client-supplied filename to a safe base name.
 *
 * Strips any directory component and every character outside a conservative
 * allowlist, so path traversal, alternate extensions and shell-significant
 * characters cannot survive into a stored filename.
 */
function sanitizeBaseName(originalName: string): string {
    // Strip any directory component. The allowlist below removes path
    // separators and every other unsafe character regardless.
    const base = originalName.split('/').pop() ?? 'file'
    const withoutExtension = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
    const safe = withoutExtension.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    return safe.length > 0 ? safe : 'file'
}

/**
 * UploadService - Handles file uploads with optional image processing
 */
@Injectable()
export class UploadService {
    constructor(
        @Inject(STORAGE_SERVICE)
        private readonly storageService: IStorageService,
        private readonly imageProcessingService: ImageProcessingService
    ) {}

    /**
     * Upload a file with optional image processing
     */
    async uploadFile(file: Express.Multer.File, options?: UploadOptions): Promise<UploadedFile> {
        const isImage = IMAGE_MIME_TYPES.includes(file.mimetype)
        const shouldProcess = isImage && options?.imageProcessing

        if (!shouldProcess) {
            return this.storageService.uploadFile(file, options)
        }

        // Process image with Sharp
        const buffer = file.buffer || (await this.getFileBuffer(file))
        const processed = await this.imageProcessingService.processImage(buffer, options.imageProcessing)

        // Derive both the name and the extension from what sharp actually
        // produced — never from the client-supplied filename. `originalname` is
        // attacker-controlled, and this tree is served statically, so trusting
        // it would allow writing e.g. `evil.html` and getting stored XSS on the
        // API origin.
        const extension = processed.format
        const newFilename = `${sanitizeBaseName(file.originalname)}.${extension}`

        const uploaded = await this.storageService.uploadBuffer(
            processed.buffer,
            newFilename,
            `image/${extension}`,
            options
        )

        return {
            ...uploaded,
            width: processed.width,
            height: processed.height
        }
    }

    /**
     * Process an image (sharp: decode, resize, re-encode) and store the result.
     * What the image is for — its size, format, folder and name — is the
     * caller's: users passes its avatar settings. The extension comes from what
     * sharp produced, never from a client-supplied name.
     *
     * @param baseName the stored file's name before the extension
     */
    async uploadImage(
        buffer: Buffer,
        {
            processing,
            subDirectory,
            filenamePrefix,
            baseName = 'image'
        }: { processing: ImageProcessingOptions; subDirectory?: string; filenamePrefix?: string; baseName?: string }
    ): Promise<UploadedFile> {
        const processed = await this.imageProcessingService.processImage(buffer, processing)

        const uploaded = await this.storageService.uploadBuffer(
            processed.buffer,
            `${baseName}.${processed.format}`,
            `image/${processed.format}`,
            { subDirectory, filenamePrefix }
        )

        return {
            ...uploaded,
            width: processed.width,
            height: processed.height
        }
    }

    /**
     * Delete a file from storage
     */
    async deleteFile(filePath: string): Promise<void> {
        return this.storageService.deleteFile(filePath)
    }

    /**
     * Get a file from storage
     */
    async getFile(filePath: string): Promise<Buffer> {
        return this.storageService.getFile(filePath)
    }

    /**
     * Check if a file exists
     */
    async fileExists(filePath: string): Promise<boolean> {
        return this.storageService.fileExists(filePath)
    }

    /**
     * Get the public URL for a file relative key
     */
    getPublicUrl(filePath: string): string {
        return this.storageService.getPublicUrl(filePath)
    }

    /**
     * Get a time-limited signed URL for reading a private file. See
     * IStorageService.getSignedReadUrl for full semantics. Use this for
     * any object stored in a private bucket; raw S3 URLs return 403.
     */
    async getSignedReadUrl(filePath: string, options?: SignedUrlOptions): Promise<string> {
        return this.storageService.getSignedReadUrl(filePath, options)
    }

    /**
     * Validate if file is a valid image
     */
    async isValidImage(file: Express.Multer.File): Promise<boolean> {
        const buffer = file.buffer || (await this.getFileBuffer(file))
        return this.imageProcessingService.isValidImage(buffer)
    }

    private async getFileBuffer(file: Express.Multer.File): Promise<Buffer> {
        if (file.buffer) return file.buffer
        if (file.path) {
            const { promises: fs } = await import('fs')
            return fs.readFile(file.path)
        }
        throw new Error('Invalid file object')
    }
}
