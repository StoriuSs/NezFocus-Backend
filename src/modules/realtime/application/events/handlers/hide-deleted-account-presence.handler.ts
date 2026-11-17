import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { AccountDeletionRequestedEvent } from '@/modules/auth'
import { announceGone, PresenceHandler } from '../../services/presence'

/**
 * An account now waiting to be deleted (D-182): offline to everyone at once.
 * Every session of theirs ended, so no tab can come back until they sign in
 * again to restore it; holding what was shown for 60 seconds, as for a closed
 * tab, would show a deleted account online. Dropped with a warning while the
 * store cannot be reached: the sweep makes them offline a minute later.
 */
@EventsHandler(AccountDeletionRequestedEvent)
export class HideDeletedAccountPresenceHandler
    extends PresenceHandler
    implements IEventHandler<AccountDeletionRequestedEvent>
{
    async handle({ userId }: AccountDeletionRequestedEvent): Promise<void> {
        await this.changing(userId, () => announceGone(this.deps, userId), undefined)
    }
}
