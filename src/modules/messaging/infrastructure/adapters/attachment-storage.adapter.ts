import { Injectable } from '@nestjs/common'
import { ERROR_TYPES } from '@/shared/constants'
import { CustomException } from '@/shared/presentation/exceptions'
import { UploadService } from '@/shared/infrastructure/storage/upload.service'
import { AttachmentStoragePort, ReadLinkOptions, Thumbnail, UploadForm } from '../../application/ports'
import { FileType } from '../../domain'

/** The thumbnail: twice the largest box C-10 draws an image in (360 × 320), WebP, no metadata. */
const THUMBNAIL = { convertToWebp: true, quality: 80, stripMetadata: true, maxWidth: 720, maxHeight: 640 }

/** What sharp names each image type when it decodes one. */
const DECODED: Partial<Record<FileType, string>> = { jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif' }

/** The storage under UploadService: S3 in development and production (D-165). */
@Injectable()
export class AttachmentStorage implements AttachmentStoragePort {
    constructor(private readonly uploads: UploadService) {}

    uploadForm(key: string, maxBytes: number, expiresInSeconds: number): Promise<UploadForm> {
        return this.uploads.createUploadForm(key, { maxBytes, expiresIn: expiresInSeconds })
    }

    sizeOf(key: string): Promise<number | null> {
        return this.uploads.getFileSize(key)
    }

    async copy(from: string, to: string): Promise<boolean> {
        try {
            await this.uploads.copyFile(from, to)
            return true
        } catch (error) {
            if (error instanceof CustomException && error.type === ERROR_TYPES.UPLOAD_FILE_NOT_FOUND) return false
            throw error
        }
    }

    async read(key: string, start: number, end: number): Promise<Uint8Array> {
        // A Buffer is a Uint8Array: no second copy of up to 25 MB.
        return this.uploads.getFileRange(key, start, end)
    }

    async thumbnail(attachmentId: string, bytes: Uint8Array, type: FileType): Promise<Thumbnail | 'other-type' | null> {
        const format = DECODED[type]
        if (!format) return 'other-type'
        try {
            // A GIF's first frame: sharp reads one page unless told more. A view of the bytes, not a copy.
            const image = await this.uploads.uploadImage(
                Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
                {
                    processing: { ...THUMBNAIL, inputFormats: [format] },
                    subDirectory: 'attachments',
                    filenamePrefix: `thumb-${attachmentId}`,
                    baseName: 'thumb'
                }
            )
            return { key: image.key, width: image.sourceWidth ?? 0, height: image.sourceHeight ?? 0 }
        } catch (error) {
            if (!(error instanceof CustomException)) throw error
            // Another image type than its name says (a PNG named .gif).
            if (error.type === ERROR_TYPES.UPLOAD_INVALID_TYPE) return 'other-type'
            // One sharp refuses (too many pixels, broken): kept as a file, not shown as an image.
            if (error.type === ERROR_TYPES.IMAGE_PROCESSING_FAILED) return null
            throw error
        }
    }

    readLink(key: string, options: ReadLinkOptions): Promise<string> {
        return this.uploads.getSignedReadUrl(key, {
            expiresIn: options.expiresInSeconds,
            responseContentType: options.contentType,
            responseContentDisposition: options.contentDisposition
        })
    }

    delete(key: string): Promise<void> {
        return this.uploads.deleteFile(key)
    }
}
