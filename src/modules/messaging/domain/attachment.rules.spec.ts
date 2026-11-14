import {
    ATTACH_WITHIN_MS,
    canAttach,
    contentCheckFor,
    contentDisposition,
    contentTypeOf,
    attachmentKey,
    uploadKeyOf,
    normaliseFileName,
    opensInBrowser,
    typeByName,
    typeOfContent,
    type AttachmentState
} from './attachment.rules'

describe('attachment rules (REQ-MSG-04, D-92, D-177)', () => {
    it('knows a file by its extension in any case, and refuses one not sent', () => {
        expect(typeByName('Cau4.JPG')).toBe('jpeg')
        expect(typeByName('de-giua-ky.pdf')).toBe('pdf')
        expect(typeByName('bai.tap.v2.docx')).toBe('docx')
        expect(typeByName('main.py')).toBe('text')
        expect(typeByName('notes.md')).toBe('text')
        // Windows scripts and executables (D-177), no extension, a dot file, a trailing dot.
        for (const name of ['run.bat', 'a.cmd', 'a.ps1', 'a.vbs', 'setup.exe', 'Makefile', '.env', 'photo.']) {
            expect(typeByName(name)).toBeNull()
        }
    })

    it('keeps a name without folders or control characters, composed', () => {
        expect(normaliseFileName('C:\\Users\\An\\bai\u0000 tap.pdf ')).toBe('bai tap.pdf')
        expect(normaliseFileName('../../etc/passwd')).toBe('passwd')
        expect(normaliseFileName('Tie\u0302\u0301ng.txt')).toBe('Tiếng.txt')
        expect(normaliseFileName(' \u0007 ')).toBe('')
    })

    it('uploads a file under a key of its own, apart from where it is kept once checked', () => {
        expect(attachmentKey('t1')).toBe('attachments/t1')
        expect(uploadKeyOf(attachmentKey('t1'))).toBe('uploads/t1')
    })

    it('checks images by decoding, Office files by their zip, text by its bytes, the rest by signature', () => {
        expect(contentCheckFor('png')).toBe('image')
        expect(contentCheckFor('pptx')).toBe('office-zip')
        expect(contentCheckFor('text')).toBe('text')
        expect(contentCheckFor('rar')).toBe('signature')
    })

    it('reads text as plain text and downloads it; shows images, PDF, video and sound', () => {
        expect(contentTypeOf('text')).toBe('text/plain; charset=utf-8')
        expect(typeOfContent('text/plain; charset=utf-8')).toBe('text')
        expect(typeOfContent('text/html')).toBeNull()
        expect(opensInBrowser('text')).toBe(false)
        expect(opensInBrowser('docx')).toBe(false)
        expect(opensInBrowser('zip')).toBe(false)
        for (const type of ['jpeg', 'gif', 'pdf', 'mp4', 'webm', 'mp3', 'm4a'] as const)
            expect(opensInBrowser(type)).toBe(true)
    })

    it('names the file in a disposition every browser reads, quotes and non-ASCII made safe', () => {
        expect(contentDisposition('đề "giữa" kỳ.pdf', true)).toBe(
            `inline; filename="__ _gi_a_ k_.pdf"; filename*=UTF-8''%C4%91%E1%BB%81%20%22gi%E1%BB%AFa%22%20k%E1%BB%B3.pdf`
        )
        expect(contentDisposition("it's.zip", false)).toBe(
            `attachment; filename="it's.zip"; filename*=UTF-8''it%27s.zip`
        )
    })

    describe('which files a message takes', () => {
        const now = new Date('2026-11-14T12:00:00Z')
        const file: AttachmentState = {
            uploaderId: 'an',
            messageId: null,
            position: null,
            completedAt: new Date('2026-11-14T11:00:00Z'),
            createdAt: new Date('2026-11-14T11:00:00Z')
        }

        it('one of the sender, checked, never sent, uploaded under 24 hours ago', () => {
            expect(canAttach(file, 'an', now)).toBe(true)
        })

        it.each([
            ['someone else', { uploaderId: 'binh' }],
            ['not checked yet', { completedAt: null }],
            ['sent already', { messageId: 'm1', position: 0 }],
            ['in a deleted message (it stays gone)', { position: 0 }],
            ['uploaded 24 hours ago', { createdAt: new Date(now.getTime() - ATTACH_WITHIN_MS) }]
        ])('not one %s', (_, change) => {
            expect(canAttach({ ...file, ...change }, 'an', now)).toBe(false)
        })
    })
})
