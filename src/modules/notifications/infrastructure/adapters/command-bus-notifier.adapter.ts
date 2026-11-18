import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { TaskReminder, UnassignedBy } from '../../domain'
import {
    AddServerItemCommand,
    AddTaskItemsCommand,
    ForgetTaskItemsCommand,
    MessageNotice,
    ModerationNotice,
    NotifierPort,
    ReadChannelItemsCommand,
    RemoveMessageItemsCommand,
    ServerNotice,
    SyncMessageItemsCommand,
    TaskNotice
} from '../../application'

const placeOf = ({ serverId, channelId, taskId }: TaskNotice) => ({ serverId, channelId, taskId })

/**
 * The NOTIFIER port (D-185), given by the global NotifierModule: only sends
 * this module's commands, whose handlers do the work, so the module giving it
 * needs nothing but CqrsModule and the callers never import this one.
 */
@Injectable()
export class CommandBusNotifier implements NotifierPort {
    constructor(private readonly commandBus: CommandBus) {}

    async messageMentions(notice: MessageNotice): Promise<void> {
        await this.commandBus.execute(new SyncMessageItemsCommand(notice))
    }

    async messagesDeleted(channelId: string, messageIds: string[]): Promise<void> {
        await this.commandBus.execute(new RemoveMessageItemsCommand(channelId, messageIds))
    }

    async channelRead(userId: string, channelId: string, messageId: string): Promise<void> {
        await this.commandBus.execute(new ReadChannelItemsCommand(userId, channelId, messageId))
    }

    async taskAssigned(notice: TaskNotice, actorId: string, userIds: string[]): Promise<void> {
        await this.commandBus.execute(
            new AddTaskItemsCommand(
                {
                    type: 'task_assigned',
                    place: placeOf(notice),
                    actorId,
                    facts: { title: notice.title, dueAt: notice.dueAt, reminder: null, unassignedBy: null }
                },
                userIds
            )
        )
    }

    async taskUnassigned(notice: TaskNotice, creatorId: string, leaverId: string, by: UnassignedBy): Promise<void> {
        await this.commandBus.execute(
            new AddTaskItemsCommand(
                {
                    type: 'task_unassigned',
                    place: placeOf(notice),
                    actorId: leaverId,
                    facts: { title: notice.title, dueAt: notice.dueAt, reminder: null, unassignedBy: by }
                },
                [creatorId]
            )
        )
    }

    async taskReminder(notice: TaskNotice & { dueAt: Date }, reminder: TaskReminder, userIds: string[]): Promise<void> {
        await this.commandBus.execute(
            new AddTaskItemsCommand(
                {
                    type: 'task_reminder',
                    place: placeOf(notice),
                    actorId: null,
                    facts: { title: notice.title, dueAt: notice.dueAt, reminder, unassignedBy: null }
                },
                userIds
            )
        )
    }

    async taskDeleted(taskId: string, userIds: string[]): Promise<void> {
        await this.commandBus.execute(new ForgetTaskItemsCommand(taskId, userIds))
    }

    async ownerTransferred(
        { serverId, serverName }: ServerNotice,
        fromUserId: string,
        toUserId: string
    ): Promise<void> {
        await this.commandBus.execute(
            new AddServerItemCommand(
                {
                    type: 'owner_transferred',
                    serverId,
                    actorId: fromUserId,
                    facts: { name: serverName, action: null, timeoutUntil: null, reason: null }
                },
                toUserId
            )
        )
    }

    async memberModerated(
        { serverId, serverName }: ServerNotice,
        userId: string,
        { action, reason, timeoutUntil }: ModerationNotice
    ): Promise<void> {
        await this.commandBus.execute(
            new AddServerItemCommand(
                {
                    type: 'moderation',
                    serverId,
                    actorId: null,
                    facts: { name: serverName, action, timeoutUntil, reason }
                },
                userId
            )
        )
    }
}
