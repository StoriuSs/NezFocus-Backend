import { dms } from '../../dm-test-world.shared-spec'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { AttachmentNotFoundError, AttachmentRecord, AttachmentRepositoryPort } from '../../../domain'
import { AttachmentStoragePort } from '../../ports'
import { GetAttachmentLinksQuery } from './attachment.queries'
import { GetAttachmentLinksHandler } from './attachment.handlers'

const server: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [
        {
            id: 'hoi-dap',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'ban-quan-ly',
            type: 'text',
            isPrivate: true,
            viewRoleIds: ['quan-ly'],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
    ]
}

const file = (id: string, change: Partial<AttachmentRecord>): AttachmentRecord => ({
    id,
    uploaderId: 'an',
    messageId: null,
    position: null,
    filename: 'de-giua-ky.pdf',
    size: 10,
    contentType: 'application/pdf',
    storageKey: `attachments/${id}`,
    thumbnailKey: null,
    width: null,
    height: null,
    completedAt: new Date(),
    createdAt: new Date(),
    channelId: null,
    ...change
})

const files = new Map(
    [
        file('public', { messageId: 'm1', position: 0, channelId: 'hoi-dap' }),
        file('private', { messageId: 'm2', position: 0, channelId: 'ban-quan-ly' }),
        file('tray', {}),
        file('unchecked', { completedAt: null, contentType: null }),
        file('deleted-message', { position: 0 })
    ].map((one) => [one.id, one])
)

const handler = new GetAttachmentLinksHandler(
    { find: jest.fn(async (id: string) => files.get(id) ?? null) } as unknown as AttachmentRepositoryPort,
    { readLink: jest.fn(async (key: string) => `signed:${key}`) } as unknown as AttachmentStoragePort,
    {
        serverIdOf: jest.fn(async () => 'ot'),
        channelIdsOf: async () => [],
        studyRoomOf: async () => null,
        namesOf: async () => ({ servers: new Map(), channels: new Map() })
    } as ChannelDirectoryPort,
    {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server,
            member: { userId, roleIds: [], timeoutUntil: null }
        }))
    } as PermissionCheckerPort,
    dms()
)
const links = (userId: string, id: string) => handler.execute(new GetAttachmentLinksQuery(userId, id))

describe('GetAttachmentLinksHandler (SRS 5.1)', () => {
    it('gives new links to a file of a message in a channel the person views', async () => {
        expect((await links('binh', 'public')).url).toBe('signed:attachments/public')
    })

    it('gives new links to the uploader for a checked file not sent yet', async () => {
        expect((await links('an', 'tray')).url).toBe('signed:attachments/tray')
    })

    it.each([
        ['in a channel they cannot view', 'binh', 'private'],
        ["of someone else's tray", 'binh', 'tray'],
        ['not checked yet', 'an', 'unchecked'],
        ['of a deleted message', 'an', 'deleted-message'],
        ['that does not exist', 'an', 'gone']
    ])('answers not found, naming nothing, for a file %s', async (_, userId, id) => {
        await expect(links(userId, id)).rejects.toBeInstanceOf(AttachmentNotFoundError)
    })
})
