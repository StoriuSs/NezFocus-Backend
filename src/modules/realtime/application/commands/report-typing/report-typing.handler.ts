import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { TypingSignalledEvent } from '../../events/typing-signalled.event'
import { ReportTypingCommand } from './report-typing.command'

/**
 * Hands a tab's typing on to the module it belongs to (ARCHITECTURE 2.2:
 * typing is messaging's): realtime only received it. Messaging hears
 * TypingSignalledEvent, decides whether it is told, and tells the channel.
 */
@CommandHandler(ReportTypingCommand)
export class ReportTypingHandler implements ICommandHandler<ReportTypingCommand> {
    constructor(private readonly eventBus: EventBus) {}

    execute({ userId, socketId, channelId }: ReportTypingCommand): Promise<void> {
        this.eventBus.publish(new TypingSignalledEvent(userId, socketId, channelId))
        return Promise.resolve()
    }
}
