import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import {
    ATTACHMENT_MAX_BYTES,
    AttachmentNameError,
    AttachmentNotFoundError,
    AttachmentRecord,
    AttachmentRepositoryPort,
    AttachmentTooLargeError,
    AttachmentTypeError,
    CannotAttachError,
    CheckedFile,
    CLEAN_UP_AFTER_MS,
    FileType,
    NewAttachment,
    TimedOutError,
    UploadingTooFastError
} from '../../../domain'
import { AttachmentStoragePort, FileCleanupPort, SendLimitPort } from '../../ports'
import { CleanUpAttachmentsCommand, CompleteUploadCommand, RequestUploadCommand } from './attachment.commands'
import { CleanUpAttachmentsHandler, CompleteUploadHandler, RequestUploadHandler } from './attachment.handlers'

/** Everyone sends files except in this server; Chi has a role that lets her; Phong is timed out. */
const server: AccessServer = {
    ownerId: 'an',
    roles: [
        {
            id: 'everyone',
            permissions: EVERYONE_DEFAULT_PERMISSIONS & ~Permission.ATTACH_FILES,
            position: 0,
            isEveryone: true
        },
        { id: 'files', permissions: Permission.ATTACH_FILES, position: 1, isEveryone: false }
    ],
    channels: [
        {
            id: 'hoi-dap',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
    ]
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A zip of these names: its directory, then its end record pointing at it. */
function zipOf(names: string[]): Uint8Array {
    const entries = names.map((name) => {
        const entry = Buffer.alloc(46 + name.length)
        entry.writeUInt32LE(0x02014b50, 0)
        entry.writeUInt16LE(name.length, 28)
        entry.write(name, 46)
        return entry
    })
    const head = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    const directory = Buffer.concat(entries)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt32LE(directory.length, 12)
    end.writeUInt32LE(head.length, 16)
    return new Uint8Array(Buffer.concat([head, directory, end]))
}

function world() {
    const rows = new Map<string, AttachmentRecord>()
    const kept = new Map<string, Uint8Array>()
    const order: string[] = []
    let next = 1

    const attachments: AttachmentRepositoryPort = {
        create: jest.fn(async (file: NewAttachment) => {
            order.push('row')
            const row: AttachmentRecord = {
                id: `f${next++}`,
                ...file,
                messageId: null,
                position: null,
                contentType: null,
                thumbnailKey: null,
                width: null,
                height: null,
                completedAt: null,
                createdAt: new Date(),
                channelId: null
            }
            rows.set(row.id, row)
            return row
        }),
        find: jest.fn(async (id: string) => rows.get(id) ?? null),
        findMany: jest.fn(),
        complete: jest.fn(async (id: string, checked: CheckedFile, at: Date) => {
            const row = rows.get(id)
            if (!row || row.completedAt) return false
            Object.assign(row, checked, { completedAt: at })
            return true
        }),
        delete: jest.fn(async (id: string) => {
            if (!rows.get(id)?.completedAt) rows.delete(id)
        }),
        forCleanUp: jest.fn(),
        purge: jest.fn()
    }
    const storage: AttachmentStoragePort = {
        uploadForm: jest.fn(async (key: string) => {
            order.push('form')
            return { url: 'https://s3.test/bucket', fields: { key } }
        }),
        sizeOf: jest.fn(async (key: string) => kept.get(key)?.length ?? null),
        copy: jest.fn(async (from: string, to: string) => {
            const bytes = kept.get(from)
            if (bytes) kept.set(to, bytes)
            return bytes !== undefined
        }),
        read: jest.fn(async (key: string, start: number, end: number) => kept.get(key)!.subarray(start, end + 1)),
        // Decodes a PNG and nothing else; a PNG whose data starts 0xff does not decode.
        thumbnail: jest.fn(async (id: string, bytes: Uint8Array, type: FileType) => {
            if (type !== 'png' || !PNG.every((byte, i) => bytes[i] === byte)) return 'other-type' as const
            return bytes[PNG.length] === 0xff ? null : { key: `thumb-${id}-${next++}`, width: 1600, height: 900 }
        }),
        readLink: jest.fn(async (key: string) => `signed:${key}`),
        delete: jest.fn(async (key: string) => void kept.delete(key))
    }
    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async () => 'ot'),
        channelIdsOf: async () => [],
        studyRoomOf: async () => null
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: {
                userId,
                roleIds: ['chi', 'phong'].includes(userId) ? ['files'] : [],
                timeoutUntil: userId === 'phong' ? new Date(Date.now() + 3600_000) : null
            }
        }))
    }
    const later: Array<{ key: string; afterMs?: number }> = []
    const cleanup: FileCleanupPort = {
        deleteFileLater: jest.fn(async (key: string, afterMs?: number) => void later.push({ key, afterMs }))
    }
    // One fixed window per person, never ending: what the 61st form in a minute meets.
    const forms = new Map<string, number>()
    const limit: SendLimitPort = {
        hit: jest.fn(async (rule, subject: string) => {
            const count = (forms.get(subject) ?? 0) + 1
            forms.set(subject, count)
            return { count, limited: count > rule.limit, retryAfterSeconds: 42 }
        }),
        release: jest.fn()
    }
    const requester = new RequestUploadHandler(attachments, storage, cleanup, channels, checker, limit)
    const completer = new CompleteUploadHandler(attachments, storage)
    const request = (userId: string, filename: string, size = 1000) =>
        requester.execute(new RequestUploadCommand(userId, 'hoi-dap', filename, size))
    /** Where the form posts (its `key` field). */
    const formKey = (id: string) => rows.get(id)!.storageKey.replace('attachments/', 'uploads/')
    /** Chi uploads `bytes` as `filename`: the form, then the file reaches the storage. */
    const upload = async (filename: string, bytes: Uint8Array) => {
        const ticket = await request('chi', filename, bytes.length)
        kept.set(ticket.upload.fields.key!, bytes)
        return ticket.attachmentId
    }
    const complete = (id: string, userId = 'chi') => completer.execute(new CompleteUploadCommand(userId, id))
    return { rows, kept, order, later, attachments, storage, limit, request, upload, complete, formKey }
}

describe('RequestUploadHandler (REQ-MSG-04, D-165)', () => {
    it('gives a form for a file of a type sent, kept under a key of its own, the form asked for before the row', async () => {
        const { request, rows, order, storage } = world()

        const ticket = await request('chi', 'C:\\bai tap\\Cau4.PNG')

        const row = rows.get(ticket.attachmentId)!
        expect(row).toMatchObject({ uploaderId: 'chi', filename: 'Cau4.PNG', size: 1000, completedAt: null })
        expect(row.storageKey).toMatch(/^attachments\/[0-9a-f-]{36}$/)
        // The form writes to an upload key only, never where the checked file is kept.
        const uploadKey = row.storageKey.replace('attachments/', 'uploads/')
        expect(storage.uploadForm).toHaveBeenCalledWith(uploadKey, ATTACHMENT_MAX_BYTES, 900)
        expect(ticket.upload.fields).toEqual({ key: uploadKey })
        expect(order).toEqual(['form', 'row'])
    })

    it('deletes the upload key a minute after its form expires, whatever reached it', async () => {
        const { request, later } = world()
        const ticket = await request('chi', 'a.png')
        expect(later).toEqual([{ key: ticket.upload.fields.key, afterMs: 16 * 60 * 1000 }])
    })

    it('needs ATTACH_FILES in the channel, and a timeout says until when first', async () => {
        const { request } = world()
        await expect(request('binh', 'a.png')).rejects.toBeInstanceOf(CannotAttachError)
        await expect(request('phong', 'a.png')).rejects.toBeInstanceOf(TimedOutError)
    })

    it('refuses a type not sent, a name with nothing in it, and a file over 25 MB, before any form', async () => {
        const { request, storage } = world()
        await expect(request('chi', 'run.bat')).rejects.toBeInstanceOf(AttachmentTypeError)
        await expect(request('chi', 'Makefile')).rejects.toBeInstanceOf(AttachmentTypeError)
        await expect(request('chi', ' /\u0000 ')).rejects.toBeInstanceOf(AttachmentNameError)
        await expect(request('chi', `${'a'.repeat(252)}.pdf`)).rejects.toBeInstanceOf(AttachmentNameError)
        await expect(request('chi', 'video.mp4', ATTACHMENT_MAX_BYTES + 1)).rejects.toBeInstanceOf(
            AttachmentTooLargeError
        )
        expect(storage.uploadForm).not.toHaveBeenCalled()
    })

    it('refuses the 61st form in a minute from one person, saying when to try again; others still get one', async () => {
        const { request, storage } = world()
        for (let i = 0; i < 60; i++) await request('chi', `bai-${i}.pdf`)

        await expect(request('chi', 'bai-60.pdf')).rejects.toEqual(new UploadingTooFastError(42))
        expect(storage.uploadForm).toHaveBeenCalledTimes(60)
        await expect(request('an', 'de-bai.pdf')).resolves.toBeDefined()
    })

    it('counts a form only once everything else is checked: a refused one costs nothing', async () => {
        const { request, limit } = world()
        await expect(request('binh', 'a.png')).rejects.toBeInstanceOf(CannotAttachError)
        await expect(request('chi', 'run.bat')).rejects.toBeInstanceOf(AttachmentTypeError)
        expect(limit.hit).not.toHaveBeenCalled()
    })
})

describe('CompleteUploadHandler (D-93)', () => {
    it('keeps an image checked, with its thumbnail and its size, and its type from the content', async () => {
        const { upload, complete, rows } = world()
        const id = await upload('cau4-1.png', new Uint8Array([...PNG, 1, 2, 3]))

        const view = await complete(id)

        expect(view).toMatchObject({
            id,
            filename: 'cau4-1.png',
            size: 11,
            contentType: 'image/png',
            width: 1600,
            height: 900,
            thumbnailUrl: expect.stringMatching(new RegExp(`^signed:thumb-${id}-`))
        })
        expect(rows.get(id)!.completedAt).toBeInstanceOf(Date)
    })

    it('takes a document by its signature, an Office file by the names in its zip, text by its bytes', async () => {
        const { upload, complete } = world()
        const pdf = await upload('de-giua-ky.pdf', new TextEncoder().encode('%PDF-1.7 ...'))
        const docx = await upload('bao-cao.docx', zipOf(['[Content_Types].xml', 'word/document.xml']))
        const code = await upload('main.py', new TextEncoder().encode('print("Xin chào")\n'))

        expect((await complete(pdf)).contentType).toBe('application/pdf')
        expect((await complete(docx)).contentType).toBe(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        expect(await complete(code)).toMatchObject({ contentType: 'text/plain; charset=utf-8', thumbnailUrl: null })
    })

    it.each([
        ['an executable named .png', 'cong-thuc.png', new Uint8Array([0x4d, 0x5a, 0x90, 0])],
        ['a PNG named .gif', 'cong-thuc.gif', new Uint8Array([...PNG, 1])],
        ['a zip of photos named .docx', 'bao-cao.docx', zipOf(['anh1.jpg', 'anh2.jpg'])],
        ['a Word file named .xlsx', 'bang-diem.xlsx', zipOf(['[Content_Types].xml', 'word/document.xml'])],
        ['a binary file named .txt', 'notes.txt', new Uint8Array([0x68, 0x69, 0x00, 0x01])]
    ])('refuses %s: the file and its row go, and the answer says why', async (_, filename, bytes) => {
        const { upload, complete, rows, kept } = world()
        const id = await upload(filename, bytes)
        const key = rows.get(id)!.storageKey

        await expect(complete(id)).rejects.toBeInstanceOf(AttachmentTypeError)

        expect(rows.has(id)).toBe(false)
        expect(kept.has(key)).toBe(false)
    })

    it('checks a copy the form cannot reach: what is posted again after the check is never what is kept', async () => {
        const { upload, complete, rows, kept, formKey } = world()
        const id = await upload('de-giua-ky.pdf', new TextEncoder().encode('%PDF-1.7 ...'))
        await complete(id)

        // The form still works for 15 minutes: something else posted with it.
        kept.set(formKey(id), new Uint8Array([0x4d, 0x5a, 0x90, 0]))

        expect(new TextDecoder().decode(kept.get(rows.get(id)!.storageKey))).toBe('%PDF-1.7 ...')
        // The upload key is let go once checked.
        expect((await complete(id)).contentType).toBe('application/pdf')
    })

    it('keeps an image that does not decode as a file, with no preview (owner, 14/11/2026)', async () => {
        const { upload, complete } = world()
        const id = await upload('anh-40mp.png', new Uint8Array([...PNG, 0xff]))

        expect(await complete(id)).toMatchObject({ contentType: 'image/png', width: null, thumbnailUrl: null })
    })

    it('reads an Office zip whose directory lies before the end read first', async () => {
        const { upload, complete } = world()
        // 70 KB of entries before the end record: past the last 64 KB read for it.
        const big = zipOf([
            '[Content_Types].xml',
            ...Array.from({ length: 1500 }, (_, i) => `ppt/slides/slide${i}.xml`),
            'ppt/presentation.xml'
        ])
        const id = await upload('bai-giang.pptx', big)

        expect((await complete(id)).contentType).toBe(
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        )
    })

    it('refuses a file over 25 MB that reached the storage anyway, whatever size was asked for', async () => {
        const { request, complete, rows, kept } = world()
        const ticket = await request('chi', 'video.mp4', 1000)
        kept.set(ticket.upload.fields.key!, new Uint8Array(ATTACHMENT_MAX_BYTES + 1))

        await expect(complete(ticket.attachmentId)).rejects.toBeInstanceOf(AttachmentTooLargeError)
        expect(rows.has(ticket.attachmentId)).toBe(false)
    })

    it('keeps one thumbnail when completed twice at once, deleting the other', async () => {
        const { upload, complete, storage } = world()
        const id = await upload('a.png', new Uint8Array([...PNG, 1]))

        const both = await Promise.all([complete(id), complete(id)])

        expect(both[0]).toEqual(both[1])
        expect(storage.thumbnail).toHaveBeenCalledTimes(2)
        // Each made one; the one not kept is deleted.
        const made = await Promise.all(jest.mocked(storage.thumbnail).mock.results.map((result) => result.value))
        const keptKey = both[0]!.thumbnailUrl!.replace('signed:', '')
        const other = made.map((thumb) => (thumb as { key: string }).key).find((key) => key !== keptKey)
        expect(storage.delete).toHaveBeenCalledWith(other)
        expect(storage.delete).not.toHaveBeenCalledWith(keptKey)
    })

    it('answers not found while nothing reached the storage, and keeps the upload', async () => {
        const { request, complete, rows } = world()
        const { attachmentId } = await request('chi', 'a.png')

        await expect(complete(attachmentId)).rejects.toBeInstanceOf(AttachmentNotFoundError)
        expect(rows.has(attachmentId)).toBe(true)
    })

    it('answers not found to anyone but the uploader, and leaves the file unchecked', async () => {
        const { request, complete, rows, kept } = world()
        const { attachmentId } = await request('chi', 'a.png')
        kept.set(rows.get(attachmentId)!.storageKey.replace('attachments/', 'uploads/'), new Uint8Array([...PNG, 1]))

        await expect(complete(attachmentId, 'binh')).rejects.toBeInstanceOf(AttachmentNotFoundError)
        expect(rows.get(attachmentId)!.completedAt).toBeNull()
    })

    it('answers the same when completed again, without reading the file again', async () => {
        const { upload, complete, storage } = world()
        const id = await upload('a.png', new Uint8Array([...PNG, 1]))
        const first = await complete(id)

        expect(await complete(id)).toEqual(first)
        expect(storage.thumbnail).toHaveBeenCalledTimes(1)
    })
})

describe('CleanUpAttachmentsHandler (REQ-MSG-04)', () => {
    const now = new Date('2026-11-14T12:00:00Z')

    it('takes the files no message holds in rounds, uploaded 25 hours ago, and deletes them and their thumbnails later', async () => {
        const full = Array.from({ length: 500 }, (_, i) => ({
            id: `file-${i}`,
            storageKey: `attachments/${i}`,
            thumbnailKey: null
        }))
        const last = { id: 'file-last', storageKey: 'attachments/last', thumbnailKey: 'attachments/thumb-last.webp' }
        const forCleanUp = jest.fn().mockResolvedValueOnce(full).mockResolvedValueOnce([last])
        const purge = jest.fn(async () => undefined)
        const cleanup: FileCleanupPort = { deleteFileLater: jest.fn(async () => undefined) }
        const handler = new CleanUpAttachmentsHandler(
            { forCleanUp, purge } as unknown as AttachmentRepositoryPort,
            cleanup
        )

        await handler.execute(new CleanUpAttachmentsCommand(now))

        expect(forCleanUp).toHaveBeenCalledTimes(2)
        expect(forCleanUp).toHaveBeenCalledWith(new Date(now.getTime() - CLEAN_UP_AFTER_MS), 500)
        expect(cleanup.deleteFileLater).toHaveBeenCalledTimes(502)
        expect(cleanup.deleteFileLater).toHaveBeenLastCalledWith('attachments/thumb-last.webp')
        expect(purge).toHaveBeenNthCalledWith(
            1,
            full.map((file) => file.id)
        )
        expect(purge).toHaveBeenNthCalledWith(2, ['file-last'])
    })

    it('queues the files before their rows go: a queue that fails keeps the rows for the next run', async () => {
        const files = [
            { id: 'file-1', storageKey: 'attachments/1', thumbnailKey: 'attachments/thumb-1.webp' },
            { id: 'file-2', storageKey: 'attachments/2', thumbnailKey: null }
        ]
        const purge = jest.fn(async () => undefined)
        const cleanup: FileCleanupPort = {
            deleteFileLater: jest
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('Redis is down'))
        }
        const handler = new CleanUpAttachmentsHandler(
            { forCleanUp: jest.fn(async () => files), purge } as unknown as AttachmentRepositoryPort,
            cleanup
        )

        await expect(handler.execute(new CleanUpAttachmentsCommand(now))).rejects.toThrow('Redis is down')

        expect(purge).not.toHaveBeenCalled()
    })
})
