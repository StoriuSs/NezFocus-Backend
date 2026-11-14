import { ImageProcessingOptions } from '../services/image-processing.service'

export interface UploadedFile {
    filename: string
    originalName: string
    path: string
    size: number
    mimetype: string
    url: string
    /** The relative storage key/path used to fetch or delete the file (e.g., 'avatars/file.webp') */
    key: string
    /** Image dimensions (only for processed images) */
    width?: number
    height?: number
    /** The image given, upright, before it was resized (only for processed images) */
    sourceWidth?: number
    sourceHeight?: number
}

export interface UploadOptions {
    /** Subdirectory within the upload folder (e.g., 'avatars', 'documents') */
    subDirectory?: string
    /** Allowed MIME types for this upload */
    allowedMimeTypes?: string[]
    /** Maximum file size in bytes */
    maxFileSize?: number
    /** Prefix for the generated filename */
    filenamePrefix?: string
    /** Image processing options (only applied to images) */
    imageProcessing?: ImageProcessingOptions
}

export interface SignedUrlOptions {
    /** Seconds the URL stays valid. Default: 3600 (1 hour). S3 v4 max is 7 days. */
    expiresIn?: number
    /**
     * Override the Content-Disposition header on the response — e.g.
     * `attachment; filename="delivery.zip"` to trigger a Save As dialog.
     * Without this, the browser inlines the object based on Content-Type.
     */
    responseContentDisposition?: string
    /**
     * Override the Content-Type header on the response: the type the content
     * was checked to be, whatever the uploader sent with it.
     */
    responseContentType?: string
}

export interface UploadFormOptions {
    /** The largest file the storage takes, in bytes: a bigger one is refused there. */
    maxBytes: number
    /** Seconds the form stays valid. */
    expiresIn: number
}

/**
 * A form a browser posts a file with, straight to the storage: `fields`
 * first, then the file as `file` (multipart/form-data), to `url`.
 */
export interface UploadForm {
    url: string
    fields: Record<string, string>
}

export interface IStorageService {
    uploadFile(file: Express.Multer.File, options?: UploadOptions): Promise<UploadedFile>
    uploadBuffer(buffer: Buffer, filename: string, mimetype: string, options?: UploadOptions): Promise<UploadedFile>
    deleteFile(filePath: string): Promise<void>
    getFile(filePath: string): Promise<Buffer>
    fileExists(filePath: string): Promise<boolean>
    /**
     * Returns the raw, unsigned URL for a stored object. Only useful when
     * the bucket (or local upload directory) is public-read. For private
     * buckets, callers should prefer `getSignedReadUrl` instead.
     */
    getPublicUrl(filePath: string): string
    /**
     * Returns a time-limited URL that grants GET access to a private
     * object. For S3 this is a presigned URL with v4 signature query
     * params. For local storage this is just the same path `getPublicUrl`
     * returns — local files are dev-only and served by nginx.
     */
    getSignedReadUrl(filePath: string, options?: SignedUrlOptions): Promise<string>
    /**
     * A form that lets a browser upload one file to `filePath` itself, with
     * the size limit kept by the storage (S3 presigned POST with a
     * `content-length-range` policy). Local storage has none and throws.
     */
    createUploadForm(filePath: string, options: UploadFormOptions): Promise<UploadForm>
    /** The stored file's size in bytes, or null when there is no such file. */
    getFileSize(filePath: string): Promise<number | null>
    /**
     * Bytes `start` to `end` (both included) of a stored file; fewer when the
     * file ends first. Throws UPLOAD_FILE_NOT_FOUND when there is no such file.
     */
    getFileRange(filePath: string, start: number, end: number): Promise<Buffer>
    /**
     * A copy of a stored file at `toPath`, made by the storage itself (no
     * bytes through the app). Throws UPLOAD_FILE_NOT_FOUND when there is no
     * such file.
     */
    copyFile(fromPath: string, toPath: string): Promise<void>
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE'
