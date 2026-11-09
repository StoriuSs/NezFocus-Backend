import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ImageProcessingOptions } from '@/shared/infrastructure/storage/services/image-processing.service'
import { UploadService } from '@/shared/infrastructure/storage/upload.service'
import { getFullUrl } from '@/shared/utils'
import { IconStoragePort } from '../../application/ports'
import { ICON_FORMATS } from '../../domain'

/**
 * JPG, PNG or WEBP by what the bytes really are; stored at most 512×512, WebP,
 * without metadata (D-82, as avatars).
 */
const ICON_IMAGE: ImageProcessingOptions = {
    inputFormats: ICON_FORMATS,
    convertToWebp: true,
    quality: 85,
    stripMetadata: true,
    maxWidth: 512,
    maxHeight: 512
}

@Injectable()
export class ServerIconStorage implements IconStoragePort {
    constructor(
        private readonly uploads: UploadService,
        private readonly config: ConfigService
    ) {}

    async uploadIcon(file: Buffer, serverId: string): Promise<string> {
        const result = await this.uploads.uploadImage(file, {
            processing: ICON_IMAGE,
            subDirectory: 'server-icons',
            filenamePrefix: `icon-${serverId}`,
            baseName: 'icon'
        })
        return result.key
    }

    async deleteFile(key: string): Promise<void> {
        await this.uploads.deleteFile(key)
    }

    /** Local storage answers with a path, given the API's base URL; S3 with an absolute presigned URL. */
    async getReadUrl(key: string): Promise<string> {
        const url = await this.uploads.getSignedReadUrl(key)
        return getFullUrl(url, this.config.get<string>('app.baseUrl')) ?? url
    }
}
