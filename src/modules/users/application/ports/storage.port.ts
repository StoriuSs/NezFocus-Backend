/**
 * Storage Port (Application Layer)
 *
 * Defines what the application needs from a file storage system.
 * No knowledge of S3, local filesystem, or any specific storage backend.
 */

export interface UploadedFileResult {
    key: string // Relative storage key
    width?: number
    height?: number
}

export interface StoragePort {
    /**
     * Upload an avatar image. Handles processing (resize, format conversion) internally.
     */
    uploadAvatar(file: Buffer, originalName: string, userId: string): Promise<UploadedFileResult>

    /**
     * Delete a file by its relative key.
     */
    deleteFile(filePath: string): Promise<void>

    /**
     * Get a URL the client can actually fetch.
     *
     * Always absolute. For local storage it is the file's public path on the
     * API's base URL; for a private S3 bucket, a time-limited presigned URL. Responses that hand a URL
     * to a browser must use this — every avatar_url in the API was previously
     * an unsigned S3 URL that returned 403 against the private bucket the code
     * documents as its secure default.
     */
    getReadUrl(key: string): Promise<string>
}

export const STORAGE = Symbol('StoragePort')
