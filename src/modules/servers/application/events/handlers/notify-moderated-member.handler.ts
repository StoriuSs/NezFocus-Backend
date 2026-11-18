import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { MemberChangedEvent } from '../member-changed.event'

/**
 * One kicked, banned or timed out (a new length too) gets a moderation item
 * in their inbox through NOTIFIER (REQ-ROLE-04, D-185, D-188): the server's
 * name, why, and until when, never who did it. Any other change to a member
 * says nothing. A failure is logged: the moderation is done, and an item is
 * not worth failing it for (as D-173).
 */
@EventsHandler(MemberChangedEvent)
export class NotifyModeratedMemberHandler implements IEventHandler<MemberChangedEvent> {
    private readonly logger = new Logger(NotifyModeratedMemberHandler.name)

    constructor(@Inject(NOTIFIER) private readonly notifier: NotifierPort) {}

    async handle({ serverId, userId, moderation }: MemberChangedEvent): Promise<void> {
        if (!moderation) return
        const { action, serverName, reason, timeoutUntil } = moderation
        try {
            await this.notifier.memberModerated({ serverId, serverName }, userId, { action, reason, timeoutUntil })
        } catch (error) {
            this.logger.error(`Could not write the ${action} item of ${userId} in server ${serverId}`, error)
        }
    }
}
