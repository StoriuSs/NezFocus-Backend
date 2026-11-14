import {
    findZipDirectory,
    hasSignature,
    isOfficeZip,
    isPlainText,
    PlainTextCheck,
    zipEntryNames
} from './attachment-content.rules'

const bytes = (...parts: Array<string | number[]>) =>
    new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)))

/** A zip's directory with these names, then its end record pointing at it, after `before` bytes of entries. */
function zipTail(names: string[], before = 0) {
    const entries = names.map((name) => {
        const entry = Buffer.alloc(46 + Buffer.byteLength(name))
        entry.writeUInt32LE(0x02014b50, 0)
        entry.writeUInt16LE(Buffer.byteLength(name), 28)
        entry.write(name, 46)
        return entry
    })
    const directory = Buffer.concat(entries)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt32LE(directory.length, 12)
    end.writeUInt32LE(before, 16)
    return { directory, file: new Uint8Array(Buffer.concat([Buffer.alloc(before), directory, end])) }
}

describe('attachment content (D-92, D-93)', () => {
    it.each([
        ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0])],
        ['png', bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])],
        ['gif', bytes('GIF89a')],
        ['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')],
        ['pdf', bytes('%PDF-1.7')],
        ['pdf', bytes(' '.repeat(500), '%PDF-1.4')],
        ['doc', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
        ['zip', bytes('PK', [3, 4])],
        ['zip', bytes('PK', [5, 6])],
        ['rar', bytes('Rar!', [0x1a, 0x07, 0x01, 0x00])],
        ['7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
        ['mp3', bytes('ID3', [4, 0])],
        ['mp3', bytes([0xff, 0xfb, 0x90])],
        ['mp4', bytes([0, 0, 0, 0x20], 'ftypisom')],
        ['m4a', bytes([0, 0, 0, 0x20], 'ftypM4A ')],
        ['webm', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], 'webm')]
    ] as const)('takes a %s by its signature', (type, head) => {
        expect(hasSignature(type, head)).toBe(true)
    })

    it.each([
        ['an executable named .jpg', 'jpeg', bytes('MZ', [0x90, 0])],
        ['a PNG named .gif', 'gif', bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])],
        ['a RIFF that is a WAV, named .webp', 'webp', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt ')],
        ['a PDF header past the first 1024 bytes', 'pdf', bytes(' '.repeat(1100), '%PDF-1.4')],
        ['a zip named .doc', 'doc', bytes('PK', [3, 4])],
        ['an Office 97 file named .docx', 'docx', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
        ['AAC named .mp3 (layer 00)', 'mp3', bytes([0xff, 0xf1, 0x50])],
        ['an mkv named .webm', 'webm', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], 'matroska')],
        ['a file too short to say', 'png', bytes([0x89], 'PN')]
    ] as const)('refuses %s', (_, type, head) => {
        expect(hasSignature(type, head)).toBe(false)
    })

    it('finds the names in a zip and knows an Office file from a zip renamed', () => {
        const office = zipTail(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'], 30)
        const place = findZipDirectory(office.file, office.file.length)
        expect(place).toEqual({ offset: 30, size: office.directory.length })
        const names = zipEntryNames(office.file.subarray(place!.offset, place!.offset + place!.size))
        expect(names).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])

        expect(isOfficeZip('docx', names)).toBe(true)
        // A Word file named .xlsx, and a plain zip of photos named .docx.
        expect(isOfficeZip('xlsx', names)).toBe(false)
        expect(isOfficeZip('docx', ['photo.jpg', 'word/document.xml'])).toBe(false)
    })

    it('has no zip directory without the end record, or with one pointing past the file', () => {
        expect(findZipDirectory(bytes('PK', [3, 4], 'nothing else here at all.....'), 33)).toBeNull()
        const broken = zipTail(['word/document.xml'], 0)
        expect(findZipDirectory(broken.file, 10)).toBeNull()
    })

    it('takes UTF-8 text, Vietnamese and a byte-order mark included, but no byte 0 and nothing else', () => {
        expect(isPlainText(new TextEncoder().encode('print("Xin chào")\n'))).toBe(true)
        expect(isPlainText(bytes([0xef, 0xbb, 0xbf], 'a,b\n'))).toBe(true)
        expect(isPlainText(bytes('abc', [0], 'def'))).toBe(false)
        // Latin-1 "é" alone is not UTF-8.
        expect(isPlainText(bytes('caf', [0xe9]))).toBe(false)
    })

    it('checks text a piece at a time, a character split between two pieces included', () => {
        const split = new PlainTextCheck()
        // "à" is c3 a0: its two bytes in two pieces.
        expect(split.push(bytes('c', [0xc3]))).toBe(true)
        expect(split.push(bytes([0xa0], 'y'))).toBe(true)
        expect(split.end()).toBe(true)

        const cut = new PlainTextCheck()
        expect(cut.push(bytes('c', [0xc3]))).toBe(true)
        // The file ends inside a character.
        expect(cut.end()).toBe(false)

        const zero = new PlainTextCheck()
        expect(zero.push(bytes('ok'))).toBe(true)
        expect(zero.push(bytes('a', [0], 'b'))).toBe(false)
        expect(zero.push(bytes('fine again'))).toBe(false)
    })
})
