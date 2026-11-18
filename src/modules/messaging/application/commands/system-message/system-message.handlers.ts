import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { ROLE_DIRECTORY, RoleDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { MESSAGE_REPOSITORY, MessageRepositoryPort } from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { ATTACHMENT_STORAGE, AttachmentStoragePort } from '../../ports'
import { messageViews } from '../../services/message-views'
import { PostMemberJoinedCommand, PostTaskDueCommand } from './system-message.commands'

/**
 * Someone joined a server by a link (D-180): "<who> joined the server" is
 * written in its welcome channel, with no author and who in `systemData`
 * (D-168), and the channel hears it. Unread for everyone but them: a system
 * message about oneself counts as one's own (D-173). A channel deleted
 * since servers read it gets nothing, and no one hears of it.
 */
@CommandHandler(PostMemberJoinedCommand)
export class PostMemberJoinedHandler implements ICommandHandler<PostMemberJoinedCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        private readonly events: EventBus
    ) {}

    async execute({ serverId, userId, channelId }: PostMemberJoinedCommand): Promise<void> {
        const notice = await this.messages.createMemberJoined(channelId, userId)
        if (!notice) return
        const [view] = await messageViews({ users: this.users, roles: this.roles, files: this.files }, serverId, [
            notice
        ])
        this.events.publish(new MessageCreatedEvent(view, null))
    }
}

/**
 * A task due soon (REQ-TASK-04, MSG-08): "Còn 24 giờ tới hạn: …" written in
 * its channel with no author, the task and the people it is for in
 * `systemData` (D-168), and the channel hears it. The people are named in
 * plain words, never mentions, so it makes no mention item (D-95); unread
 * for everyone, as it names no one person. A channel deleted since gets
 * nothing; a reminder said already (a job run again) is not said twice.
 */
@CommandHandler(PostTaskDueCommand)
export class PostTaskDueHandler implements ICommandHandler<PostTaskDueCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        private readonly events: EventBus
    ) {}

    async execute({ serverId, channelId, due }: PostTaskDueCommand): Promise<void> {
        const notice = await this.messages.createTaskDue(channelId, due)
        if (!notice) return
        const [view] = await messageViews({ users: this.users, roles: this.roles, files: this.files }, serverId, [
            notice
        ])
        this.events.publish(new MessageCreatedEvent(view, null))
    }
}

export const SYSTEM_MESSAGE_COMMAND_HANDLERS = [PostMemberJoinedHandler, PostTaskDueHandler]
