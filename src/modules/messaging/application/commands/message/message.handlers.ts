import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, ROLE_DIRECTORY, RoleDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CannotDeleteMessageError,
    MESSAGE_REPOSITORY,
    MessageNotFoundError,
    MessageRecord,
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
import { keptText, MentionWork, reachingViewers } from '../../services/mentions'
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
 *
 * What the text may mention is decided before it is counted too
 * (REQ-MSG-03): a role the author may not mention is kept as words, which
 * can make it too long (`length`). Once counted, the people it is about
 * (those mentioned, the author answered, deleted or not, D-39) who see the
 * channel get their mention rows with the message (D-164).
 */
@CommandHandler(SendMessageCommand)
export class SendMessageHandler implements ICommandHandler<SendMessageCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(SEND_LIMIT) private readonly limit: SendLimitPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, channelId, content, nonce, replyToId }: SendMessageCommand): Promise<MessageView> {
        const now = new Date()
        const channel = await openChannel(this.channels, this.permissions, channelId, userId, now)
        requireSending(channel, now)
        const views = (records: MessageRecord[]) =>
            messageViews({ users: this.users, roles: this.roles }, channel.serverId, records)

        const sent = await this.messages.findByNonce(userId, nonce)
        if (sent && sent.channelId !== channelId) throw new NonceUsedElsewhereError()
        if (sent?.deleted) throw new MessageNotFoundError(sent.id)
        if (sent) return (await views([sent]))[0]
        let answeredAuthorId: string | null = null
        if (replyToId) {
            const answered = await this.messages.find(replyToId)
            if (answered?.channelId !== channelId || answered.type !== 'regular')
                throw new MessageRuleError('reply_target')
            answeredAuthorId = answered.author?.id ?? null
        }
        const work: MentionWork = { channelId, channel, authorId: userId, content, answeredAuthorId, now }
        const kept = await keptText(this.roles, work)

        const counted = await countSending(this.limit, userId, channelId)
        let saved: Awaited<ReturnType<MessageRepositoryPort['create']>>
        try {
            const mentions = await reachingViewers(this.permissions, work, kept.mentions)
            saved = await this.messages.create({
                channelId,
                authorId: userId,
                nonce,
                replyToId,
                content: kept.content,
                mentions
            })
        } catch (error) {
            // Nothing was made (the channel went meanwhile, a permission read failed): nothing to count.
            await counted.release()
            throw error
        }
        const { message, created, deleted } = saved
        if (!created) await counted.release()
        if (message.channelId !== channelId) throw new NonceUsedElsewhereError()
        if (deleted) throw new MessageNotFoundError(message.id)
        const [view] = await views([message])
        // Not awaited by the bus: a socket that misses it catches up over REST.
        if (created) this.events.publish(new MessageCreatedEvent(view, nonce))
        return view
    }
}

/**
 * Only the author edits, and only while they may still post in the channel
 * (REQ-MSG-05, SRS 1.70): a timeout says until when, a channel for managers
 * only refuses. The new text's mentions replace the old ones, decided as
 * when sending (D-164); the author answered stays one even if that message
 * was deleted since (D-39). The same kept text again changes nothing and
 * tells no one. Like sending, it returns the message it tells the channel
 * (D-169).
 */
@CommandHandler(EditMessageCommand)
export class EditMessageHandler implements ICommandHandler<EditMessageCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
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
        const views = (records: MessageRecord[]) =>
            messageViews({ users: this.users, roles: this.roles }, channel.serverId, records)
        const work: MentionWork = {
            channelId: message.channelId,
            channel,
            authorId: userId,
            content,
            answeredAuthorId: await this.answeredAuthorOf(message.replyTo),
            now
        }
        const kept = await keptText(this.roles, work)
        if (message.content === kept.content) return (await views([message]))[0]

        const mentions = await reachingViewers(this.permissions, work, kept.mentions)
        const edited = await this.messages.edit(messageId, kept.content, mentions, now)
        if (!edited) throw new MessageNotFoundError(messageId)
        const [view] = await views([edited])
        this.events.publish(new MessageUpdatedEvent(view))
        return view
    }

    /** Who wrote the message a reply answers: a deleted one is quoted without its author, so it is read. */
    private async answeredAuthorOf(answered: MessageRecord['replyTo']): Promise<string | null> {
        if (!answered) return null
        if (!answered.deleted) return answered.author?.id ?? null
        return (await this.messages.find(answered.id))?.author?.id ?? null
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
