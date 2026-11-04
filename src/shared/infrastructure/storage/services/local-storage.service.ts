import { Injectable, HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { extensionFor } from './file-extension'
import { CustomException } from '@/shared/presentation/exceptions'
import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants'
import { MESSAGES } from '@/shared/constants'
import { IStorageService, UploadedFile, UploadOptions } from '../interfaces/storage.interface'

@Injectable()
export class LocalStorageService implements IStorageService {
    private uploadDir: string
    private maxFileSize: number
    private allowedFileTypes: string[]

    constructor(private readonly configService: ConfigService) {
        this.uploadDir = this.configService.get<string>('upload.local.uploadDir') || './uploads'
        this.maxFileSize = this.configService.get<number>('upload.maxFileSize') || 5 * 1024 * 1024
        this.allowedFileTypes = this.configService.get<string[]>('upload.allowedFileTypes') || [
            'image/jpeg',
            'image/png',
            'image/jpg',
            'image/webp'
        ]

        // Ensure upload directory exists
        this.ensureUploadDirectory()
    }

    private async ensureUploadDirectory(subDir?: string): Promise<string> {
        const targetDir = subDir ? join(this.uploadDir, subDir) : this.uploadDir
        try {
            await fs.access(targetDir)
        } catch {
            await fs.mkdir(targetDir, { recursive: true })
        }
        return targetDir
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

        // Ensure subdirectory exists
        const targetDir = await this.ensureUploadDirectory(subDir)

        // Generate unique filename
        // From the checked type, not the client's filename (see extensionFor).
        const fileExtension = extensionFor(file.mimetype)
        const uniqueSuffix = `${Date.now()}-${randomUUID().split('-')[0]}`
        const filename = prefix ? `${prefix}-${uniqueSuffix}.${fileExtension}` : `${uniqueSuffix}.${fileExtension}`
        const filePath = join(targetDir, filename)

        // Save file (handle both buffer and file path)
        if (file.buffer) {
            // Memory storage
            await fs.writeFile(filePath, file.buffer)
        } else if (file.path) {
            // Disk storage - file already saved by multer, just return info
            const url = subDir ? `uploads/${subDir}/${filename}` : `uploads/${filename}`
            const key = subDir ? `${subDir}/${filename}` : filename
            return {
                filename,
                originalName: file.originalname,
                path: file.path,
                size: file.size,
                mimetype: file.mimetype,
                url,
                key
            }
        } else {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_INVALID_FILE,
                type: ERROR_TYPES.UPLOAD_INVALID_FILE,
                message: 'Invalid file object',
                status: HttpStatus.BAD_REQUEST
            })
        }

        const url = subDir ? `uploads/${subDir}/${filename}` : `uploads/${filename}`
        const key = subDir ? `${subDir}/${filename}` : filename
        return {
            filename,
            originalName: file.originalname,
            path: filePath,
            size: file.size,
            mimetype: file.mimetype,
            url,
            key
        }
    }

    async deleteFile(filename: string): Promise<void> {
        const filePath = join(this.uploadDir, filename)

        try {
            await fs.unlink(filePath)
        } catch (error) {
            // If the file is already gone, that's exactly what we want!
            const nodeError = error as NodeJS.ErrnoException
            if (nodeError.code === 'ENOENT') {
                return
            }

            throw new CustomException({
                code: ERROR_CODES.UPLOAD_DELETE_FAILED,
                type: ERROR_TYPES.UPLOAD_DELETE_FAILED,
                message: `Failed to delete file: ${filename}`,
                status: HttpStatus.INTERNAL_SERVER_ERROR
            })
        }
    }

    async getFile(filename: string): Promise<Buffer> {
        const filePath = join(this.uploadDir, filename)

        try {
            return await fs.readFile(filePath)
        } catch {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_FILE_NOT_FOUND,
                type: ERROR_TYPES.UPLOAD_FILE_NOT_FOUND,
                message: `File not found: ${filename}`,
                status: HttpStatus.NOT_FOUND
            })
        }
    }

    async uploadBuffer(
        buffer: Buffer,
        filename: string,
        mimetype: string,
        options?: Omit<UploadOptions, 'allowedMimeTypes' | 'maxFileSize'>
    ): Promise<UploadedFile> {
        const subDir = options?.subDirectory || ''
        const prefix = options?.filenamePrefix || ''

        // Ensure subdirectory exists
        const targetDir = await this.ensureUploadDirectory(subDir)

        // Generate unique filename
        const fileExtension = filename.split('.').pop() || 'bin'
        const uniqueSuffix = `${Date.now()}-${randomUUID().split('-')[0]}`
        const finalFilename = prefix ? `${prefix}-${uniqueSuffix}.${fileExtension}` : `${uniqueSuffix}.${fileExtension}`
        const filePath = join(targetDir, finalFilename)

        // Save buffer to file
        await fs.writeFile(filePath, buffer)

        const url = subDir ? `uploads/${subDir}/${finalFilename}` : `uploads/${finalFilename}`
        const key = subDir ? `${subDir}/${finalFilename}` : finalFilename
        return {
            filename: finalFilename,
            originalName: filename,
            path: filePath,
            size: buffer.length,
            mimetype,
            url,
            key
        }
    }

    async fileExists(filePath: string): Promise<boolean> {
        const fullPath = join(this.uploadDir, filePath)
        try {
            await fs.access(fullPath)
            return true
        } catch {
            return false
        }
    }

    /**
     * Generate the public URL for a file
     */
    getPublicUrl(filePath: string): string {
        // Strip out 'uploads/' if it's already there (legacy format safety)
        const key = filePath.includes('uploads/') ? filePath.split('uploads/')[1] : filePath
        return `uploads/${key}`
    }

    /**
     * Local storage has no concept of signed URLs — files are served by
     * the local nginx (or NestJS static handler) at /uploads/*. Returning
     * the same path `getPublicUrl` would return keeps the IStorageService
     * interface uniform and lets callers treat local and S3 the same.
     * The signed-URL options are intentionally ignored in dev.
     */
    async getSignedReadUrl(filePath: string): Promise<string> {
        return this.getPublicUrl(filePath)
    }
}
