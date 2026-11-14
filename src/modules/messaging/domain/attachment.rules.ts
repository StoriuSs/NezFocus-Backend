/** Largest file a message takes, in bytes (REQ-MSG-04). */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

/** Most files in one message (REQ-MSG-04). */
export const ATTACHMENTS_PER_MESSAGE = 10

/** Longest file name kept, in characters; a longer one is refused. */
export const ATTACHMENT_NAME_MAX = 255

/** How long the upload form stays valid (D-165). */
export const UPLOAD_FORM_TTL_SECONDS = 15 * 60

/** How long the read links given with a message stay valid; a client asks for new ones after. */
export const READ_LINK_TTL_SECONDS = 60 * 60

const HOUR_MS = 60 * 60 * 1000

/** A file is sent within 24 hours of its upload, or not at all (REQ-MSG-04). */
export const ATTACH_WITHIN_MS = 24 * HOUR_MS

/**
 * A file never sent is cleaned up 25 hours after its upload: an hour past the
 * last moment it could be sent, so the clean-up never takes one being attached.
 */
export const CLEAN_UP_AFTER_MS = 25 * HOUR_MS

/** What a file is, by its name and then by its content (D-92). */
export type FileType =
    | 'jpeg'
    | 'png'
    | 'webp'
    | 'gif'
    | 'pdf'
    | 'doc'
    | 'docx'
    | 'xls'
    | 'xlsx'
    | 'ppt'
    | 'pptx'
    | 'zip'
    | 'rar'
    | '7z'
    | 'mp3'
    | 'm4a'
    | 'mp4'
    | 'webm'
    | 'text'

/**
 * Plain text sent as files (D-177): text, data and source code. No Windows
 * scripts (bat, cmd, ps1, vbs), which run when opened.
 */
// prettier-ignore
export const TEXT_EXTENSIONS = [
    'txt', 'md', 'csv', 'tsv', 'log', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini',
    'html', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx', 'py', 'ipynb', 'c', 'h', 'cpp',
    'hpp', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'swift', 'dart', 'sql', 'sh',
    'r', 'm', 'tex'
] as const

const BY_EXTENSION: Record<string, FileType> = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    webp: 'webp',
    gif: 'gif',
    pdf: 'pdf',
    doc: 'doc',
    docx: 'docx',
    xls: 'xls',
    xlsx: 'xlsx',
    ppt: 'ppt',
    pptx: 'pptx',
    zip: 'zip',
    rar: 'rar',
    '7z': '7z',
    mp3: 'mp3',
    m4a: 'm4a',
    mp4: 'mp4',
    webm: 'webm',
    ...Object.fromEntries(TEXT_EXTENSIONS.map((extension) => [extension, 'text' as const]))
}

/** The type a file says it is by its extension (any case), or null for one not sent (D-92, D-177). */
export function typeByName(filename: string): FileType | null {
    const dot = filename.lastIndexOf('.')
    if (dot <= 0 || dot === filename.length - 1) return null
    return BY_EXTENSION[filename.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * A file name as kept: composed (NFC), without what a name cannot hold
 * (folders, control characters) and the spaces around it. Empty when nothing
 * is left.
 */
export function normaliseFileName(name: string): string {
    const base = name.normalize('NFC').split(/[\\/]/).pop() ?? ''
    return [...base]
        .filter((character) => {
            const code = character.codePointAt(0)!
            return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)
        })
        .join('')
        .trim()
}

/** How a file's content is checked at `/complete` (D-93). */
export type ContentCheck = 'signature' | 'office-zip' | 'image' | 'text'

export function contentCheckFor(type: FileType): ContentCheck {
    if (type === 'jpeg' || type === 'png' || type === 'webp' || type === 'gif') return 'image'
    if (type === 'docx' || type === 'xlsx' || type === 'pptx') return 'office-zip'
    if (type === 'text') return 'text'
    return 'signature'
}

const CONTENT_TYPES: Record<FileType, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'video/webm',
    // Never a type a browser runs or draws as a page (D-177).
    text: 'text/plain; charset=utf-8'
}

/** The type a checked file is read with, whatever its uploader sent. */
export const contentTypeOf = (type: FileType) => CONTENT_TYPES[type]

/** The type a kept content type stands for (the inverse of `contentTypeOf`). */
export function typeOfContent(contentType: string): FileType | null {
    const found = (Object.keys(CONTENT_TYPES) as FileType[]).find((type) => CONTENT_TYPES[type] === contentType)
    return found ?? null
}

/**
 * Shown in the browser (D-94): images, PDF, video and sound. Everything else
 * is downloaded, text files included (D-177).
 */
export function opensInBrowser(type: FileType): boolean {
    return contentCheckFor(type) === 'image' || ['pdf', 'mp3', 'm4a', 'mp4', 'webm'].includes(type)
}

/**
 * The Content-Disposition a read link answers with (RFC 6266): `inline` or
 * `attachment`, with the name in plain ASCII for old clients and in full as
 * `filename*` (RFC 5987).
 */
export function contentDisposition(filename: string, inline: boolean): string {
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    const encoded = encodeURIComponent(filename).replace(
        /['()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    )
    return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** Where a file is kept, by a key made for it: never by its name, which the uploader chose. */
export const attachmentKey = (token: string) => `attachments/${token}`

/**
 * Where the browser uploads it first, with the form (D-165). `/complete`
 * copies it to its kept key before checking it: the form still works for 15
 * minutes, and must never reach what was checked.
 */
export const uploadKeyOf = (storageKey: string) => storageKey.replace(/^attachments\//, 'uploads/')

/** An uploaded file as the rules see it. */
export interface AttachmentState {
    uploaderId: string
    messageId: string | null
    /** Kept when its message is deleted (the message goes, the file waits for the clean-up). */
    position: number | null
    completedAt: Date | null
    createdAt: Date
}

/**
 * Whether `userId` may send this file in a message now: their own, checked
 * (`/complete`), never sent before (a deleted message's files stay gone),
 * and uploaded less than 24 hours ago.
 */
export function canAttach(file: AttachmentState, userId: string, now: Date): boolean {
    return (
        file.uploaderId === userId &&
        file.completedAt !== null &&
        file.messageId === null &&
        file.position === null &&
        now.getTime() - file.createdAt.getTime() < ATTACH_WITHIN_MS
    )
}
