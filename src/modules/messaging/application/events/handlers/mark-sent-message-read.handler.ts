import { Logger } from '@nestjs/common'
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { ChannelNotFoundError } from '../../../domain'
import { AckChannelCommand } from '../../commands/read-state/read-state.commands'
import { MessageCreatedEvent } from '../message-created.event'

/**
 * Sending a message marks its channel read up to it for the author (D-173),
 * on every tab and device: they were at the bottom of the channel. After the
 * message is saved, so a failure here never fails the send (it is logged);
 * an author who left the server meanwhile has nothing to mark. System
 * messages have no author and mark nothing.
 */
@EventsHandler(MessageCreatedEvent)
export class MarkSentMessageReadHandler implements IEventHandler<MessageCreatedEvent> {
    private readonly logger = new Logger(MarkSentMessageReadHandler.name)

    constructor(private readonly commandBus: CommandBus) {}

    async handle({ message }: MessageCreatedEvent): Promise<void> {
        if (!message.author) return
        try {
            await this.commandBus.execute(new AckChannelCommand(message.author.id, message.channelId, message.id))
        } catch (error) {
            if (error instanceof ChannelNotFoundError) return
            this.logger.error(`Could not mark message ${message.id} read for its author`, error)
        }
    }
}
