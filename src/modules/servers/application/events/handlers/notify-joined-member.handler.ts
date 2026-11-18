import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { MemberChangedEvent } from '../member-changed.event'

/**
 * One joined a server, from an invite (again, after a kick or a ban lifted):
 * NOTIFIER reads their kick and ban items of it not read yet (D-202, D-185),
 * so a removal they know of is not said again. Making a server joins its
 * owner too: one update that finds nothing, the server being new. Any other
 * change to a member says nothing. A failure is logged: the join is done
 * (as D-173).
 */
@EventsHandler(MemberChangedEvent)
export class NotifyJoinedMemberHandler implements IEventHandler<MemberChangedEvent> {
    private readonly logger = new Logger(NotifyJoinedMemberHandler.name)

    constructor(@Inject(NOTIFIER) private readonly notifier: NotifierPort) {}

    async handle({ serverId, userId, action }: MemberChangedEvent): Promise<void> {
        if (action !== 'joined') return
        try {
            await this.notifier.memberJoined(serverId, userId)
        } catch (error) {
            this.logger.error(`Could not read the removal items of ${userId} in server ${serverId}`, error)
        }
    }
}
