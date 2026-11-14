import { contentDisposition, MessageFile, opensInBrowser, READ_LINK_TTL_SECONDS, typeOfContent } from '../../domain'
import { AttachmentStoragePort } from '../ports'

/** A file as the chat shows it: links to it and its thumbnail that end after an hour (REQ-MSG-04). */
export interface AttachmentView {
    id: string
    filename: string
    size: number
    contentType: string
    /** An image's size, upright; null for any other file. */
    width: number | null
    height: number | null
    url: string
    /** Saves the file ("Tải về"): `url` itself for a file that is only downloaded. */
    downloadUrl: string
    /** An image's thumbnail (WebP); null for any other file. */
    thumbnailUrl: string | null
}

/**
 * The file with its read links (D-94): answered with the type its content
 * was checked to be; shown in the browser for an image, a PDF, video or
 * sound, downloaded for anything else (text too, D-177).
 */
export async function attachmentView(storage: AttachmentStoragePort, file: MessageFile): Promise<AttachmentView> {
    const type = typeOfContent(file.contentType)
    const inline = type !== null && opensInBrowser(type)
    const link = (shown: boolean) =>
        storage.readLink(file.storageKey, {
            contentType: file.contentType,
            contentDisposition: contentDisposition(file.filename, shown),
            expiresInSeconds: READ_LINK_TTL_SECONDS
        })
    const [url, downloadUrl, thumbnailUrl] = await Promise.all([
        link(inline),
        inline ? link(false) : null,
        file.thumbnailKey
            ? storage.readLink(file.thumbnailKey, {
                  contentType: 'image/webp',
                  contentDisposition: 'inline',
                  expiresInSeconds: READ_LINK_TTL_SECONDS
              })
            : null
    ])
    return {
        id: file.id,
        filename: file.filename,
        size: file.size,
        contentType: file.contentType,
        width: file.width,
        height: file.height,
        url,
        downloadUrl: downloadUrl ?? url,
        thumbnailUrl
    }
}
