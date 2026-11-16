import { EventBus } from '@nestjs/cqrs'
import { RoleDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { MessageRecord, MessageRepositoryPort } from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { AttachmentStoragePort } from '../../ports'
import { PostMemberJoinedCommand } from './system-message.commands'
import { PostMemberJoinedHandler } from './system-message.handlers'

const FILES = { readLink: async (key: string) => `signed:${key}` } as unknown as AttachmentStoragePort

const joined = (channelId: string, userId: string): MessageRecord => ({
    id: 'notice1',
    channelId,
    type: 'system',
    author: null,
    content: '',
    systemEvent: 'member_joined',
    systemData: { userId },
    systemUser: { id: userId, username: 'dung.pham', displayName: 'Dũng', avatarKey: null },
    replyTo: null,
    mentionEveryone: false,
    mentionHereUserIds: [],
    mentionRoleIds: [],
    mentionUsers: [],
    attachments: [],
    editedAt: null,
    pinned: false,
    createdAt: new Date('2026-10-16T19:58:00Z')
})

function world(channelGone = false) {
    const messages = {
        createMemberJoined: jest.fn(async (channelId: string, userId: string) =>
            channelGone ? null : joined(channelId, userId)
        )
    } as unknown as jest.Mocked<MessageRepositoryPort>
    const users = { avatarUrl: jest.fn(async () => null) } as unknown as UserDirectoryPort
    const roles = { rolesOf: jest.fn(async () => []) } as unknown as RoleDirectoryPort
    const events = { publish: jest.fn() }
    const handler = new PostMemberJoinedHandler(messages, users, roles, FILES, events as unknown as EventBus)
    return { handler, messages, events }
}

describe('PostMemberJoinedHandler (REQ-SRV-01, D-83, D-180)', () => {
    it('posts "Dũng joined the server" in the welcome channel, and the channel hears it', async () => {
        const { handler, messages, events } = world()

        await handler.execute(new PostMemberJoinedCommand('ot', 'dung', 'chao-mung'))

        expect(messages.createMemberJoined).toHaveBeenCalledWith('chao-mung', 'dung')
        expect(events.publish).toHaveBeenCalledTimes(1)
        const [event] = events.publish.mock.calls[0] as [MessageCreatedEvent]
        expect(event).toBeInstanceOf(MessageCreatedEvent)
        expect(event).toMatchObject({
            nonce: null,
            message: {
                channelId: 'chao-mung',
                type: 'system',
                author: null,
                systemEvent: 'member_joined',
                systemData: { userId: 'dung' },
                systemUser: { id: 'dung', displayName: 'Dũng', avatarUrl: null }
            }
        })
    })

    it('tells no one when the channel was deleted before the message could be written', async () => {
        const { handler, events } = world(true)

        await handler.execute(new PostMemberJoinedCommand('ot', 'dung', 'chao-mung'))

        expect(events.publish).not.toHaveBeenCalled()
    })
})
