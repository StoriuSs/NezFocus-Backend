import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { PRESENCE, PresencePort } from '@/modules/realtime'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { createdRead, NOTIFICATION_REPOSITORY, NotificationRepositoryPort } from '../../../domain'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { BLOCK_LIST, BlockListPort, MESSAGE_PREVIEWS, MessagePreviewsPort } from '../../ports'
import { Inbox } from '../../services/inbox'
import { notificationViews } from '../../services/notification-views'
import { AddServerItemCommand } from './server-item.commands'

/**
 * An owner or moderation item for one person (REQ-SRV-05, REQ-ROLE-04), with
 * the server's name and what was done as they are now, which the item keeps.
 * Never for the one who acted (D-185). A block does not stop it (L2-d): a
 * server handed over is about the person's own role, and a moderation item
 * names no one. A kick or ban is made read when the
 * person still has a tab connected, whose dialog showed it (D-187); a
 * timeout and a server handed over arrive unread (D-201). Presence that
 * cannot be read counts as no tab: the item is unread and the next opening
 * of the app says it (11 S-MOD-02 › H1).
 */
@CommandHandler(AddServerItemCommand)
export class AddServerItemHandler extends Inbox implements ICommandHandler<AddServerItemCommand> {
    constructor(
        @Inject(NOTIFICATION_REPOSITORY) notifications: NotificationRepositoryPort,
        @Inject(MEMBERSHIP) membership: MembershipPort,
        @Inject(PERMISSION_CHECKER) checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) users: UserDirectoryPort,
        @Inject(MESSAGE_PREVIEWS) previews: MessagePreviewsPort,
        eventBus: EventBus,
        @Inject(BLOCK_LIST) blocks: BlockListPort,
        @Inject(PRESENCE) private readonly presence: PresencePort
    ) {
        super(notifications, membership, checker, users, previews, eventBus, blocks)
    }

    async execute({ draft, userId }: AddServerItemCommand): Promise<void> {
        if (draft.actorId === userId) return
        const connected = draft.type === 'moderation' && (await this.presence.connected(userId))
        const record = await this.notifications.addServerItem(
            draft,
            userId,
            new Date(),
            createdRead(draft.facts.action, connected)
        )
        if (!record) return
        const [notification] = await notificationViews(this.viewSources, [record])
        this.eventBus.publish(new NotificationsCreatedEvent([{ userId, notification: notification! }]))
    }
}

export const SERVER_ITEM_COMMAND_HANDLERS = [AddServerItemHandler]
