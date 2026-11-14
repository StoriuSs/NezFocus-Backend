import type { FileType } from './attachment.rules'

/**
 * What a file's bytes really are (D-92, D-93): the uploader's name for it is
 * only a claim. Pure functions over bytes; `/complete` reads the bytes each
 * one needs from the storage.
 */

/** Bytes read from the start of a file for its signature. */
export const HEAD_BYTES = 4096

/** Bytes read from the end of a zip for its directory: the end record and the longest comment it can carry. */
export const ZIP_TAIL_BYTES = 22 + 0xffff

/** The longest zip directory read; an Office file's is a few KB. */
export const ZIP_DIRECTORY_MAX_BYTES = 1024 * 1024

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0))

function startsWith(bytes: Uint8Array, signature: number[], at = 0): boolean {
    return bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte)
}

function contains(bytes: Uint8Array, signature: number[], within: number): boolean {
    const end = Math.min(bytes.length, within) - signature.length
    for (let at = 0; at <= end; at++) if (startsWith(bytes, signature, at)) return true
    return false
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ZIP = [0x50, 0x4b, 0x03, 0x04]
const EMPTY_ZIP = [0x50, 0x4b, 0x05, 0x06]

/** An MP3 frame header: 11 set bits, then a version and a layer that exist (layer 00 is AAC's, not MP3's). */
function isMp3Frame(bytes: Uint8Array): boolean {
    if (bytes.length < 2 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false
    const version = (bytes[1] >> 3) & 0b11
    const layer = (bytes[1] >> 1) & 0b11
    return version !== 0b01 && layer !== 0b00
}

/**
 * Whether the start of a file (`HEAD_BYTES`, fewer when it is shorter) is
 * the signature of `type`. For the types `contentCheckFor` checks so, and the
 * first gate of the others: an Office zip is a zip, an image starts as one.
 *
 * Office 97-2003 files (doc, xls, ppt) share one container, so any of the
 * three passes as the other two: each is still a document that is only
 * downloaded. MP4 and M4A share theirs too.
 */
export function hasSignature(type: FileType, head: Uint8Array): boolean {
    switch (type) {
        case 'jpeg':
            return startsWith(head, [0xff, 0xd8, 0xff])
        case 'png':
            return startsWith(head, [0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a])
        case 'gif':
            return startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))
        case 'webp':
            return startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)
        case 'pdf':
            // Readers take the header anywhere in the first 1024 bytes.
            return contains(head, ascii('%PDF-'), 1024)
        case 'doc':
        case 'xls':
        case 'ppt':
            return startsWith(head, OLE)
        case 'docx':
        case 'xlsx':
        case 'pptx':
            return startsWith(head, ZIP)
        case 'zip':
            return startsWith(head, ZIP) || startsWith(head, EMPTY_ZIP)
        case 'rar':
            return (
                startsWith(head, [...ascii('Rar!'), 0x1a, 0x07, 0x00]) ||
                startsWith(head, [...ascii('Rar!'), 0x1a, 0x07, 0x01, 0x00])
            )
        case '7z':
            return startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
        case 'mp3':
            return startsWith(head, ascii('ID3')) || isMp3Frame(head)
        case 'm4a':
        case 'mp4':
            return startsWith(head, ascii('ftyp'), 4)
        case 'webm':
            // Matroska's container, whose header names its kind: webm, not matroska (mkv).
            return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]) && contains(head, ascii('webm'), 64)
        case 'text':
            return true
    }
}

/**
 * Where a zip's directory is, from its last bytes (`ZIP_TAIL_BYTES`, fewer
 * when the file is shorter): the end record, found from the end. Null when
 * there is none, or it points outside the file.
 */
export function findZipDirectory(tail: Uint8Array, fileSize: number): { offset: number; size: number } | null {
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
    for (let at = tail.length - 22; at >= 0; at--) {
        if (view.getUint32(at, true) !== 0x06054b50) continue
        const size = view.getUint32(at + 12, true)
        const offset = view.getUint32(at + 16, true)
        if (offset + size > fileSize) return null
        return { offset, size }
    }
    return null
}

/** The names in a zip's directory (read at the place `findZipDirectory` gave); stops at the first entry that is not one. */
export function zipEntryNames(directory: Uint8Array): string[] {
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength)
    const decoder = new TextDecoder()
    const names: string[] = []
    let at = 0
    while (at + 46 <= directory.length && view.getUint32(at, true) === 0x02014b50) {
        const nameLength = view.getUint16(at + 28, true)
        const extraLength = view.getUint16(at + 30, true)
        const commentLength = view.getUint16(at + 32, true)
        if (at + 46 + nameLength > directory.length) break
        names.push(decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)))
        at += 46 + nameLength + extraLength + commentLength
    }
    return names
}

/** The part each Office Open XML file has, besides `[Content_Types].xml`. */
const OFFICE_PART: Partial<Record<FileType, string>> = {
    docx: 'word/document.xml',
    xlsx: 'xl/workbook.xml',
    pptx: 'ppt/presentation.xml'
}

/** Whether a zip's names are those of an Office file of `type` (docx, xlsx, pptx): a zip renamed is not one. */
export function isOfficeZip(type: FileType, names: string[]): boolean {
    const part = OFFICE_PART[type]
    return part !== undefined && names.includes('[Content_Types].xml') && names.includes(part)
}

/** How much of a text file is read at a time: a 25 MB one is never held whole. */
export const TEXT_CHUNK_BYTES = 1024 * 1024

/**
 * Plain text (D-92), checked a piece at a time: UTF-8 throughout (a
 * byte-order mark allowed, a character split between two pieces too), and no
 * byte 0. `push` each piece in order, then `end`; either says false as soon as
 * the text is not plain.
 */
export class PlainTextCheck {
    private readonly decoder = new TextDecoder('utf-8', { fatal: true })
    private plain = true

    push(bytes: Uint8Array): boolean {
        if (!this.plain) return false
        if (bytes.includes(0)) return (this.plain = false)
        try {
            this.decoder.decode(bytes, { stream: true })
        } catch {
            this.plain = false
        }
        return this.plain
    }

    end(): boolean {
        if (!this.plain) return false
        try {
            this.decoder.decode()
        } catch {
            this.plain = false
        }
        return this.plain
    }
}

/** Plain text in one piece (`PlainTextCheck`). */
export function isPlainText(bytes: Uint8Array): boolean {
    const check = new PlainTextCheck()
    return check.push(bytes) && check.end()
}
