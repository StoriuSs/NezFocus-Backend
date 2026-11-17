import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import {
    MessageNotice,
    NotifierPort,
    ReadChannelItemsCommand,
    RemoveMessageItemsCommand,
    SyncMessageItemsCommand
} from '../../application'

/**
 * The NOTIFIER port (D-185), given by the global NotifierModule: only sends
 * this module's commands, whose handlers do the work, so the module giving it
 * needs nothing but CqrsModule and the callers never import this one.
 */
@Injectable()
export class CommandBusNotifier implements NotifierPort {
    constructor(private readonly commandBus: CommandBus) {}

    async messageMentions(notice: MessageNotice): Promise<void> {
        await this.commandBus.execute(new SyncMessageItemsCommand(notice))
    }

    async messagesDeleted(channelId: string, messageIds: string[]): Promise<void> {
        await this.commandBus.execute(new RemoveMessageItemsCommand(channelId, messageIds))
    }

    async channelRead(userId: string, channelId: string, messageId: string): Promise<void> {
        await this.commandBus.execute(new ReadChannelItemsCommand(userId, channelId, messageId))
    }
}
