import { EventBus } from '@nestjs/cqrs'
import { RoleDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { MessageRecord, MessageRepositoryPort, TaskDueData } from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { AttachmentStoragePort } from '../../ports'
import { PostMemberJoinedCommand, PostTaskDueCommand } from './system-message.commands'
import { PostMemberJoinedHandler, PostTaskDueHandler } from './system-message.handlers'

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
    systemUsers: [],
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
        ),
        createTaskDue: jest.fn(async (channelId: string, due: TaskDueData) =>
            channelGone
                ? null
                : {
                      ...joined(channelId, 'dung'),
                      systemEvent: 'task_due',
                      systemData: { ...due },
                      systemUser: null,
                      systemUsers: due.userIds.map((id) => ({
                          id,
                          username: id,
                          displayName: id.toUpperCase(),
                          avatarKey: `${id}.png`
                      }))
                  }
        )
    } as unknown as jest.Mocked<MessageRepositoryPort>
    const users = { avatarUrl: jest.fn(async () => null) } as unknown as UserDirectoryPort
    const roles = { rolesOf: jest.fn(async () => []) } as unknown as RoleDirectoryPort
    const events = { publish: jest.fn() }
    const handler = new PostMemberJoinedHandler(messages, users, roles, FILES, events as unknown as EventBus)
    const taskDue = new PostTaskDueHandler(messages, users, roles, FILES, events as unknown as EventBus)
    return { handler, taskDue, messages, events }
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

describe('PostTaskDueHandler (REQ-TASK-04, MSG-08)', () => {
    const due: TaskDueData = {
        taskId: 't1',
        title: 'Nộp báo cáo giữa kỳ',
        reminder: '24h',
        dueAt: '2026-11-05T16:59:00.000Z',
        userIds: ['an', 'binh']
    }

    it('posts the reminder in the task’s channel with its people named like authors, and the channel hears it', async () => {
        const { taskDue, messages, events } = world()

        await taskDue.execute(new PostTaskDueCommand('nd', 'viec-nhom', due))

        expect(messages.createTaskDue).toHaveBeenCalledWith('viec-nhom', due)
        const [event] = events.publish.mock.calls[0] as [MessageCreatedEvent]
        expect(event).toMatchObject({
            message: {
                channelId: 'viec-nhom',
                type: 'system',
                author: null,
                systemEvent: 'task_due',
                systemData: due,
                systemUser: null,
                systemUsers: [
                    { id: 'an', displayName: 'AN', avatarUrl: null },
                    { id: 'binh', displayName: 'BINH', avatarUrl: null }
                ]
            }
        })
    })

    it('tells no one when the channel was deleted meanwhile, or the reminder was said already', async () => {
        const { taskDue, events } = world(true)
        await taskDue.execute(new PostTaskDueCommand('nd', 'viec-nhom', due))
        expect(events.publish).not.toHaveBeenCalled()
    })
})
