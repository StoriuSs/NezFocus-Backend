import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { MESSAGE_REPOSITORY, MessageRepositoryPort, NonceUsedElsewhereError } from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { SEND_LIMIT, SendLimitPort } from '../../ports'
import { openChannel, requireSending } from '../../services/channel-access'
import { MessageView, messageViews } from '../../services/message-views'
import { countSending } from '../../services/sending-limits'
import { SendMessageCommand } from './message.commands'

/**
 * Permission, then the limits, then save, then tell the channel (REQ-MSG-01,
 * ARCHITECTURE 2.3).
 *
 * A nonce its author has used already answers with that message before
 * anything is counted (REQ-MSG-10): a retry after a lost answer, even long
 * after the idempotency key has expired; one used in another channel is
 * refused (CONFLICT_ERROR). Two sends of one nonce at once both
 * pass that look; the database keeps one, only the send that made it tells
 * the channel, and the other gives its count back (REQ-MSG-10: a repeated
 * nonce is not counted). The text arrives normalised and checked by the
 * request (`MessageContentField`).
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

    async execute({ userId, channelId, content, nonce }: SendMessageCommand): Promise<MessageView> {
        const now = new Date()
        requireSending(await openChannel(this.channels, this.permissions, channelId, userId, now), now)

        const sent = await this.messages.findByNonce(userId, nonce)
        if (sent && sent.channelId !== channelId) throw new NonceUsedElsewhereError()
        if (sent) return (await messageViews(this.users, [sent]))[0]

        const counted = await countSending(this.limit, userId, channelId)
        let saved: Awaited<ReturnType<MessageRepositoryPort['create']>>
        try {
            saved = await this.messages.create({ channelId, authorId: userId, content, nonce })
        } catch (error) {
            // Nothing was made (the channel went meanwhile): nothing to count.
            await counted.release()
            throw error
        }
        const { message, created } = saved
        if (!created) await counted.release()
        if (message.channelId !== channelId) throw new NonceUsedElsewhereError()
        const [view] = await messageViews(this.users, [message])
        // Not awaited by the bus: a socket that misses it catches up over REST.
        if (created) this.events.publish(new MessageCreatedEvent(view, nonce))
        return view
    }
}

export const MESSAGE_COMMAND_HANDLERS = [SendMessageHandler]
