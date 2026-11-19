import { Permission } from '@/modules/permissions'
import {
    ATTACH_WITHIN_MS,
    AttachmentNotFoundError,
    AttachmentRecord,
    AttachmentRepositoryPort,
    CannotAttachError,
    MessageRuleError
} from '../../domain'
import { OpenChannel } from './channel-access'
import { requireSendableFiles } from './message-files'

const now = new Date('2026-11-14T12:00:00Z')

const file = (id: string, change: Partial<AttachmentRecord> = {}): AttachmentRecord => ({
    id,
    uploaderId: 'an',
    messageId: null,
    position: null,
    filename: `${id}.png`,
    size: 10,
    contentType: 'image/png',
    storageKey: `attachments/${id}`,
    thumbnailKey: null,
    width: 1,
    height: 1,
    completedAt: new Date(now.getTime() - 60_000),
    createdAt: new Date(now.getTime() - 60_000),
    channelId: null,
    ...change
})

const kept = [
    file('ok'),
    file('ok2'),
    file('binh', { uploaderId: 'binh' }),
    file('unchecked', { completedAt: null }),
    file('sent', { messageId: 'm1', position: 0, channelId: 'hoi-dap' }),
    file('old', { createdAt: new Date(now.getTime() - ATTACH_WITHIN_MS) })
]
const attachments = {
    findMany: jest.fn(async (ids: string[]) => kept.filter((one) => ids.includes(one.id)))
} as unknown as AttachmentRepositoryPort

const channel = (permissions: bigint): OpenChannel => ({
    serverId: 'ot',
    type: 'text',
    permissions,
    member: { userId: 'an', roleIds: [], timeoutUntil: null }
})
const WITH_FILES = Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.ATTACH_FILES

const check = (ids: string[], permissions = WITH_FILES) =>
    requireSendableFiles(attachments, channel(permissions), 'an', ids, now)

describe('the files a message takes (REQ-MSG-04)', () => {
    it('passes the sender’s own checked files, and a message with none, even without ATTACH_FILES', async () => {
        await expect(check(['ok', 'ok2'])).resolves.toBeUndefined()
        await expect(check([], Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES)).resolves.toBeUndefined()
    })

    it('names every file that cannot be sent, so the client uploads those again', async () => {
        const error = await check(['ok', 'binh', 'unchecked', 'sent', 'old', 'gone']).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(AttachmentNotFoundError)
        expect((error as AttachmentNotFoundError).details.attachmentIds).toEqual([
            'binh',
            'unchecked',
            'sent',
            'old',
            'gone'
        ])
    })

    it('needs ATTACH_FILES in the channel', async () => {
        await expect(check(['ok'], Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES)).rejects.toBeInstanceOf(
            CannotAttachError
        )
    })

    it('takes at most 10 files, each once', async () => {
        const rule = new MessageRuleError('attachments')
        await expect(check(Array.from({ length: 11 }, (_, i) => `f${i}`))).rejects.toEqual(rule)
        await expect(check(['ok', 'ok'])).rejects.toEqual(rule)
    })
})
