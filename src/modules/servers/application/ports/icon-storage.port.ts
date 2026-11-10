/** Where server icons are kept: no knowledge of S3 or the local disk. */
export interface IconStoragePort {
    /** Check, resize and store an icon (512×512 WebP at most); returns its key. */
    uploadIcon(file: Buffer, serverId: string): Promise<string>

    deleteFile(key: string): Promise<void>

    /** A URL the browser can fetch: absolute, presigned on a private bucket. */
    getReadUrl(key: string): Promise<string>
}

export const ICON_STORAGE = Symbol('IconStoragePort')
