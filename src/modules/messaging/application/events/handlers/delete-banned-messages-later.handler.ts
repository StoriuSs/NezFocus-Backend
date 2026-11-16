import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { MemberChangedEvent } from '@/modules/servers'
import { MESSAGE_PURGE, MessagePurgePort } from '../../ports'

/**
 * A ban that deletes the member's recent messages (REQ-ROLE-04, D-181):
 * queued, not done here, as a failed event handler is never run again. The
 * job deletes them channel by channel (DeleteRecentMessagesCommand).
 */
@EventsHandler(MemberChangedEvent)
export class DeleteBannedMessagesLaterHandler implements IEventHandler<MemberChangedEvent> {
    private readonly logger = new Logger(DeleteBannedMessagesLaterHandler.name)

    constructor(@Inject(MESSAGE_PURGE) private readonly purge: MessagePurgePort) {}

    async handle({ serverId, userId, deleteMessages }: MemberChangedEvent): Promise<void> {
        // Only a ban carries a window (servers' moderate.ts).
        if (!deleteMessages) return
        await this.purge.deleteRecentLater(serverId, userId, deleteMessages).catch((error: unknown) => {
            // Lost once the ban has answered (D-181): what to delete by hand.
            const { from, to } = deleteMessages
            this.logger.error(
                `Recent messages of ${userId} in server ${serverId} (${from.toISOString()} to ${to.toISOString()}) not queued for deletion: ${String(error)}`
            )
            throw error
        })
    }
}
