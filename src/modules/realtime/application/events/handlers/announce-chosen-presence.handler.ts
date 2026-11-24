import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { PresenceChosenEvent, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    EVENT_PUBLISHER,
    EventPublisherPort,
    FRIENDS,
    FriendsPort,
    PRESENCE_STORE,
    PresenceStorePort
} from '../../ports'
import { announcePresence, underLock } from '../../services/presence'

/**
 * Another status chosen in the menu (REQ-AUTH-07): what others see of the
 * person is worked out again and told, within the 2 seconds S-ME-01 asks.
 * Not kept while the store cannot be reached: the next signal of their
 * tabs that changes something (going unused, a new tab) tells it.
 */
@EventsHandler(PresenceChosenEvent)
export class AnnounceChosenPresenceHandler implements IEventHandler<PresenceChosenEvent> {
    private readonly logger = new Logger(AnnounceChosenPresenceHandler.name)

    constructor(
        @Inject(PRESENCE_STORE) private readonly store: PresenceStorePort,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(FRIENDS) private readonly friends: FriendsPort
    ) {}

    async handle({ userId }: PresenceChosenEvent): Promise<void> {
        const { store, publisher, membership, directory, friends } = this
        const deps = { store, publisher, membership, directory, friends }
        try {
            await underLock(deps, userId, () => announcePresence(deps, userId, Date.now()), this.logger)
        } catch (error) {
            this.logger.warn(`Presence not told: ${(error as Error)?.message}`)
        }
    }
}
