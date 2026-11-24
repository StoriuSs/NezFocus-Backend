import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { ROLE_DIRECTORY, RoleDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { MESSAGE_REPOSITORY, MessageRepositoryPort } from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { ATTACHMENT_STORAGE, AttachmentStoragePort } from '../../ports'
import { messageViews } from '../../services/message-views'
import {
    PostCallEndedCommand,
    PostMemberJoinedCommand,
    PostStudySessionCommand,
    PostTaskDueCommand
} from './system-message.commands'

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

/**
 * A study session started or ended (REQ-MSG-08, D-222): "{who} đã bắt đầu
 * phiên học 25/5" or "Phiên học đã kết thúc" written in the room's chat with
 * no author, what it says in `systemData` (D-168), and the room hears it.
 * Who started it reads it as their own (D-173), as `userId` names them; the
 * end names no one. A room deleted since gets nothing.
 */
@CommandHandler(PostStudySessionCommand)
export class PostStudySessionHandler implements ICommandHandler<PostStudySessionCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        private readonly events: EventBus
    ) {}

    async execute({ serverId, channelId, notice }: PostStudySessionCommand): Promise<void> {
        const message = await this.messages.createStudySession(channelId, notice)
        if (!message) return
        const [view] = await messageViews({ users: this.users, roles: this.roles, files: this.files }, serverId, [
            message
        ])
        this.events.publish(new MessageCreatedEvent(view, null))
    }
}

/**
 * A call over (REQ-MSG-08, D-106): "{Bình / Bạn} đã gọi · …" written in
 * its DM with no author, the call in `systemData` (D-168), and the DM
 * hears it. Its caller reads it as their own (D-173), as `userId` names
 * them: unread for the callee only, so a missed call shows the DM again on
 * their side (D-244). A missed call's item (REQ-SOCIAL-06) is written
 * through NOTIFIER before the DM hears the message (L4-f): a tab reading
 * the DM can only mark it read once it is there, or it would stay unread
 * for good. The item failing is logged; the message is still heard. A DM
 * gone since gets nothing.
 */
@CommandHandler(PostCallEndedCommand)
export class PostCallEndedHandler implements ICommandHandler<PostCallEndedCommand> {
    private readonly logger = new Logger(PostCallEndedHandler.name)

    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        @Inject(NOTIFIER) private readonly notifier: NotifierPort,
        private readonly events: EventBus
    ) {}

    async execute({ channelId, notice, missedCalleeId }: PostCallEndedCommand): Promise<void> {
        const message = await this.messages.createCallEnded(channelId, notice)
        if (!message) return
        if (missedCalleeId) {
            await this.notifier
                .missedCall({ callerId: notice.userId, calleeId: missedCalleeId, channelId, messageId: message.id })
                .catch((error: unknown) => this.logger.error(`No missed call item for message ${message.id}`, error))
        }
        // No server: a DM's message reads no role (D-238).
        const [view] = await messageViews({ users: this.users, roles: this.roles, files: this.files }, null, [message])
        this.events.publish(new MessageCreatedEvent(view, null))
    }
}

export const SYSTEM_MESSAGE_COMMAND_HANDLERS = [
    PostMemberJoinedHandler,
    PostTaskDueHandler,
    PostStudySessionHandler,
    PostCallEndedHandler
]
