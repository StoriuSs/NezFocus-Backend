import { ChannelNotFoundError, MessageNotFoundError, MessageRepositoryPort, StoredMessage } from '../../domain'
import { ChannelSources, ChannelUse, OpenChannel, openChannel } from './channel-access'

/** A message not deleted, and its channel as the person sees it. */
export interface OpenMessage {
    message: StoredMessage
    channel: OpenChannel
}

/**
 * The message `messageId` and its channel, as `userId` sees them now, for
 * `use` (openChannel). No such message, a deleted one, or one in a channel
 * they may not view all answer the same "message not found", which names no
 * channel (NFR-SEC-05).
 */
export async function openMessage(
    messages: MessageRepositoryPort,
    sources: ChannelSources,
    messageId: string,
    userId: string,
    now: Date,
    use: ChannelUse = 'view'
): Promise<OpenMessage> {
    const message = await messages.find(messageId)
    if (!message || message.deleted) throw new MessageNotFoundError(messageId)
    try {
        return { message, channel: await openChannel(sources, message.channelId, userId, now, use) }
    } catch (error) {
        if (error instanceof ChannelNotFoundError) throw new MessageNotFoundError(messageId)
        throw error
    }
}
