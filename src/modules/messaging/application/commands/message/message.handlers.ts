import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CannotDeleteMessageError,
    MESSAGE_REPOSITORY,
    MessageNotFoundError,
    MessageRepositoryPort,
    NonceUsedElsewhereError,
    MessageRuleError,
    NotYourMessageError,
    TimedOutError
} from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { MessageDeletedEvent } from '../../events/message-deleted.event'
import { MessageUpdatedEvent } from '../../events/message-updated.event'
import { SEND_LIMIT, SendLimitPort } from '../../ports'
import { openChannel, requireSending, timedOutUntil } from '../../services/channel-access'
import { openMessage } from '../../services/message-access'
import { MessageView, messageViews } from '../../services/message-views'
import { countSending } from '../../services/sending-limits'
import { DeleteMessageCommand, EditMessageCommand, SendMessageCommand } from './message.commands'

/**
 * Permission, then the limits, then save, then tell the channel (REQ-MSG-01,
 * ARCHITECTURE 2.3).
 *
 * A nonce its author has used already answers with that message before
 * anything is counted (REQ-MSG-10): a retry after a lost answer, even long
 * after the idempotency key has expired; one used in another channel is
 * refused (CONFLICT_ERROR), and one whose message was deleted since is not
 * found: the client drops its copy. Two sends of one nonce at once both
 * pass that look; the database keeps one, only the send that made it tells
 * the channel, and the other gives its count back (REQ-MSG-10: a repeated
 * nonce is not counted). The text arrives normalised and checked by the
 * request (`MessageContentField`).
 *
 * A reply answers a regular message of the same channel, deleted or not
 * (REQ-MSG-05): anything else is refused before anything is counted.
 */
@CommandHandler(SendMessageCommand)
export class SendMessageHandler implements ICommandHandler<SendMessageCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(SEND_LIMIT) private readonly limit: SendLimitPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, channelId, content, nonce, replyToId }: SendMessageCommand): Promise<MessageView> {
        const now = new Date()
        requireSending(await openChannel(this.channels, this.permissions, channelId, userId, now), now)

        const sent = await this.messages.findByNonce(userId, nonce)
        if (sent && sent.channelId !== channelId) throw new NonceUsedElsewhereError()
        if (sent?.deleted) throw new MessageNotFoundError(sent.id)
        if (sent) return (await messageViews(this.users, [sent]))[0]
        if (replyToId) {
            const answered = await this.messages.find(replyToId)
            if (answered?.channelId !== channelId || answered.type !== 'regular')
                throw new MessageRuleError('reply_target')
        }

        const counted = await countSending(this.limit, userId, channelId)
        let saved: Awaited<ReturnType<MessageRepositoryPort['create']>>
        try {
            saved = await this.messages.create({ channelId, authorId: userId, content, nonce, replyToId })
        } catch (error) {
            // Nothing was made (the channel went meanwhile): nothing to count.
            await counted.release()
            throw error
        }
        const { message, created, deleted } = saved
        if (!created) await counted.release()
        if (message.channelId !== channelId) throw new NonceUsedElsewhereError()
        if (deleted) throw new MessageNotFoundError(message.id)
        const [view] = await messageViews(this.users, [message])
        // Not awaited by the bus: a socket that misses it catches up over REST.
        if (created) this.events.publish(new MessageCreatedEvent(view, nonce))
        return view
    }
}

/**
 * Only the author edits, and only while they may still post in the channel
 * (REQ-MSG-05, SRS 1.70): a timeout says until when, a channel for managers
 * only refuses. The same text again changes nothing and tells no one. Like
 * sending, it returns the message it tells the channel (D-169).
 */
@CommandHandler(EditMessageCommand)
export class EditMessageHandler implements ICommandHandler<EditMessageCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, messageId, content }: EditMessageCommand): Promise<MessageView> {
        const now = new Date()
        const { message, channel } = await openMessage(
            this.messages,
            this.channels,
            this.permissions,
            messageId,
            userId,
            now
        )
        // A system message has no author (D-168), so no one passes here.
        if (message.author?.id !== userId) throw new NotYourMessageError()
        requireSending(channel, now)
        if (message.content === content) return (await messageViews(this.users, [message]))[0]

        const edited = await this.messages.edit(messageId, content, now)
        if (!edited) throw new MessageNotFoundError(messageId)
        const [view] = await messageViews(this.users, [edited])
        this.events.publish(new MessageUpdatedEvent(view))
        return view
    }
}

/**
 * The author deletes their own message unless timed out, MANAGE_MESSAGES
 * anyone's (REQ-MSG-05, SRS 1.70); a system message no one. The row stays,
 * emptied, for the replies to it; the history no longer shows it.
 */
@CommandHandler(DeleteMessageCommand)
export class DeleteMessageHandler implements ICommandHandler<DeleteMessageCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, messageId }: DeleteMessageCommand): Promise<void> {
        const now = new Date()
        const { message, channel } = await openMessage(
            this.messages,
            this.channels,
            this.permissions,
            messageId,
            userId,
            now
        )
        if (message.type === 'system') throw new CannotDeleteMessageError()
        const until = timedOutUntil(channel, now)
        if (until) throw new TimedOutError(until)
        const manages = (channel.permissions & Permission.MANAGE_MESSAGES) !== 0n
        if (!manages && message.author?.id !== userId) throw new CannotDeleteMessageError()

        if (!(await this.messages.remove(messageId, now))) throw new MessageNotFoundError(messageId)
        this.events.publish(new MessageDeletedEvent(messageId, message.channelId))
    }
}

export const MESSAGE_COMMAND_HANDLERS = [SendMessageHandler, EditMessageHandler, DeleteMessageHandler]
