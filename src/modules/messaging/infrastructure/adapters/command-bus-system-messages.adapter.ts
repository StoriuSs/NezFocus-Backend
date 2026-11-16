import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { SystemMessagesPort } from '@/modules/servers'
import { PostMemberJoinedCommand } from '../../application'

/**
 * Servers' SYSTEM_MESSAGES port, answered by this module (D-180): servers
 * cannot import messaging, which imports it, so it asks through this
 * adapter, given by the global SystemMessagesModule. Only sends this
 * module's own command; the handler does the work.
 */
@Injectable()
export class CommandBusSystemMessages implements SystemMessagesPort {
    constructor(private readonly commandBus: CommandBus) {}

    async memberJoined(serverId: string, userId: string, channelId: string): Promise<void> {
        await this.commandBus.execute(new PostMemberJoinedCommand(serverId, userId, channelId))
    }
}
