import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { PRESENCE, PresencePort } from '@/modules/realtime'
import {
    CHANNEL_DIRECTORY,
    ChannelDirectoryPort,
    MEMBERSHIP,
    MembershipPort,
    ROLE_DIRECTORY,
    RoleDirectoryPort
} from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    ATTACHMENT_REPOSITORY,
    AttachmentRepositoryPort,
    CannotDeleteMessageError,
    hasSomething,
    findMentions,
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
import { MessagesBulkDeletedEvent } from '../../events/messages-bulk-deleted.event'
import { MessageUpdatedEvent } from '../../events/message-updated.event'
import { ATTACHMENT_STORAGE, AttachmentStoragePort, SEND_LIMIT, SendLimitPort } from '../../ports'
import { openChannel, requireSending, timedOutUntil } from '../../services/channel-access'
import { keptText, MentionWork, Reach, reachingViewers } from '../../services/mentions'
import { openMessage } from '../../services/message-access'
import { requireSendableFiles } from '../../services/message-files'
import { MessageView, messageViews } from '../../services/message-views'
import { countSending } from '../../services/sending-limits'
import {
    DeleteMessageCommand,
    DeleteRecentMessagesCommand,
    EditMessageCommand,
    SendMessageCommand
} from './message.commands'

/**
 * Permission, then the limits, then save, then tell the channel (REQ-MSG-01,
 * ARCHITECTURE 2.3).
 *
 * Files are checked before anything is counted (`requireSendableFiles`):
 * ATTACH_FILES, and each the sender's own, checked, never sent, under 24
 * hours old. A message holds text or files (D-93). The repository takes the
 * files with the message only if no other message took one meanwhile.
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
        @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(SEND_LIMIT) private readonly limit: SendLimitPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        @Inject(PRESENCE) private readonly presence: PresencePort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        private readonly events: EventBus
    ) {}

    /** Whom a message reaches: permissions, presence and members (services/mentions.ts). */
    private get reach(): Reach {
        return { checker: this.permissions, presence: this.presence, membership: this.membership }
    }

    async execute({
        userId,
        channelId,
        content,
        nonce,
        replyToId,
        attachmentIds
    }: SendMessageCommand): Promise<MessageView> {
        const now = new Date()
        const channel = await openChannel(this.channels, this.permissions, channelId, userId, now)
        requireSending(channel, now)
        const views = (records: MessageRecord[]) =>
            messageViews({ users: this.users, roles: this.roles, files: this.files }, channel.serverId, records)

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
        await requireSendableFiles(this.attachments, channel, userId, attachmentIds, now)
        const work: MentionWork = { channelId, channel, authorId: userId, content, answeredAuthorId, now }
        const kept = await keptText(this.roles, work)
        if (!hasSomething(kept.content, attachmentIds.length)) throw new MessageRuleError('empty')

        const counted = await countSending(this.limit, userId, channelId)
        let saved: Awaited<ReturnType<MessageRepositoryPort['create']>>
        try {
            const mentions = await reachingViewers(this.reach, work, kept.mentions)
            saved = await this.messages.create({
                channelId,
                authorId: userId,
                nonce,
                replyToId,
                content: kept.content,
                mentions,
                attachmentIds
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
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        @Inject(PRESENCE) private readonly presence: PresencePort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        private readonly events: EventBus
    ) {}

    /** Whom a message reaches: permissions, presence and members (services/mentions.ts). */
    private get reach(): Reach {
        return { checker: this.permissions, presence: this.presence, membership: this.membership }
    }

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
            messageViews({ users: this.users, roles: this.roles, files: this.files }, channel.serverId, records)
        const work: MentionWork = {
            channelId: message.channelId,
            channel,
            authorId: userId,
            content,
            answeredAuthorId: await this.answeredAuthorOf(message.replyTo),
            now
        }
        const kept = await keptText(this.roles, work)
        // Its files stay: all the text may go from a message that has some (S-CHAT-01 `edit-mode`).
        if (!hasSomething(kept.content, message.attachments.length)) throw new MessageRuleError('empty')
        if (message.content === kept.content) return (await views([message]))[0]

        // An @here that already reached people keeps them; one added now reaches who is here now (D-176).
        const heldHere = findMentions(message.content).here ? message.mentionHereUserIds : undefined
        const mentions = await reachingViewers(this.reach, work, kept.mentions, heldHere)
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

/** How many messages of one channel a ban's job deletes in one transaction, and tells in one event. */
const DELETE_BATCH = 100

/**
 * A banned member's recent messages (D-181), each deleted as one deleted
 * alone, a batch of one channel at a time, and each batch told to its
 * channel. No permission to check: the ban was. A batch that fails fails the
 * job, and the queue runs it again: what was deleted is not found again.
 */
@CommandHandler(DeleteRecentMessagesCommand)
export class DeleteRecentMessagesHandler implements ICommandHandler<DeleteRecentMessagesCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ serverId, userId, from, to }: DeleteRecentMessagesCommand): Promise<void> {
        for (const channelId of await this.channels.channelIdsOf(serverId)) {
            // Each batch from the last one deleted: the rows emptied stay in the index.
            let after: string | null = null
            let ids: string[]
            do {
                ids = await this.messages.removeRecent(channelId, userId, { from, to }, after, DELETE_BATCH, new Date())
                if (ids.length) this.events.publish(new MessagesBulkDeletedEvent(channelId, ids))
                after = ids.at(-1) ?? after
            } while (ids.length === DELETE_BATCH)
        }
    }
}

export const MESSAGE_COMMAND_HANDLERS = [
    SendMessageHandler,
    EditMessageHandler,
    DeleteMessageHandler,
    DeleteRecentMessagesHandler
]
