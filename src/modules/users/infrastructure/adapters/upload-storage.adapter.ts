import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { UploadService } from '@/shared/infrastructure/storage/upload.service'
import { ImageProcessingOptions } from '@/shared/infrastructure/storage/services/image-processing.service'
import { getFullUrl } from '@/shared/utils'
import { StoragePort, UploadedFileResult } from '@/modules/users/application'

/**
 * Upload Storage Adapter — Outbound Adapter
 *
 * Adapts the existing UploadService to the StoragePort interface.
 * The application layer uses StoragePort, which knows nothing about
 * Express, Multer, or the underlying storage implementation.
 */
/** An avatar: at most 512×512, WebP, no metadata (a photo's EXIF can hold where it was taken). */
const AVATAR_IMAGE: ImageProcessingOptions = {
    convertToWebp: true,
    quality: 85,
    stripMetadata: true,
    maxWidth: 512,
    maxHeight: 512
}

@Injectable()
export class UploadStorage implements StoragePort {
    constructor(
        private readonly uploadService: UploadService,
        private readonly config: ConfigService
    ) {}

    async uploadAvatar(fileBuffer: Buffer, _originalName: string, userId: string): Promise<UploadedFileResult> {
        const result = await this.uploadService.uploadImage(fileBuffer, {
            processing: AVATAR_IMAGE,
            subDirectory: 'avatars',
            filenamePrefix: `avatar-${userId}`,
            baseName: 'avatar'
        })

        return {
            key: result.key,
            width: result.width,
            height: result.height
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        await this.uploadService.deleteFile(filePath)
    }

    /**
     * Local storage answers with a path, which gets the API's base URL; an S3
     * presigned URL is absolute already and passes through untouched.
     */
    async getReadUrl(key: string): Promise<string> {
        const url = await this.uploadService.getSignedReadUrl(key)
        return getFullUrl(url, this.config.get<string>('app.baseUrl')) ?? url
    }
}
