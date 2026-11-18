import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { ServerChangedEvent } from '../server-changed.event'

/**
 * A server handed over (REQ-SRV-05): the new owner gets an item naming the
 * old one, through NOTIFIER (D-185). Any other change to the server says
 * nothing. A failure is logged: the server is handed over, and an item is
 * not worth failing it for (as D-173).
 */
@EventsHandler(ServerChangedEvent)
export class NotifyNewOwnerHandler implements IEventHandler<ServerChangedEvent> {
    private readonly logger = new Logger(NotifyNewOwnerHandler.name)

    constructor(@Inject(NOTIFIER) private readonly notifier: NotifierPort) {}

    async handle({ serverId, ownerTransfer }: ServerChangedEvent): Promise<void> {
        if (!ownerTransfer) return
        const { fromUserId, toUserId, serverName } = ownerTransfer
        try {
            await this.notifier.ownerTransferred({ serverId, serverName }, fromUserId, toUserId)
        } catch (error) {
            this.logger.error(`Could not tell ${toUserId} that server ${serverId} is theirs`, error)
        }
    }
}
