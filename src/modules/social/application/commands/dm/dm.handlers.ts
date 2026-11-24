import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CannotMessageUserError,
    DM_REPOSITORY,
    DmNotFoundError,
    DmRepositoryPort,
    PersonNotFoundError,
    RELATIONSHIP_REPOSITORY,
    RelationshipRepositoryPort
} from '../../../domain'
import { DmChangedEvent } from '../../events/dm-changed.event'
import { mayReach, recipientOf } from '../../services/dm-reach'
import { CloseDmCommand, OpenDmCommand } from './dm.commands'

/**
 * My DM with someone (REQ-SOCIAL-04, D-242, D-244). One there already is
 * answered whatever stands between us now (I still read it), and open again
 * on my side. None yet: only someone I may message gets one, made under the
 * pair's lock so two opening it at once make one; not found for oneself, no
 * such account, one not completed, deleted or waiting to be (D-243), and
 * CANNOT_MESSAGE_USER, the same for every other reason. A new DM is open on
 * my side only: the other one sees it with its first message (D-244), their
 * sockets already in its room.
 */
@CommandHandler(OpenDmCommand)
export class OpenDmHandler implements ICommandHandler<OpenDmCommand> {
    constructor(
        @Inject(DM_REPOSITORY) private readonly dms: DmRepositoryPort,
        @Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, otherId }: OpenDmCommand): Promise<{ channelId: string }> {
        if (otherId === userId) throw new PersonNotFoundError(otherId)
        if (!(await this.dms.findByPair(userId, otherId))) {
            const recipient = await recipientOf(this.users, userId, otherId)
            if (!recipient || recipient.gone) throw new PersonNotFoundError(otherId)
            const sources = { relationships: this.relationships, membership: this.membership, users: this.users }
            if (!(await mayReach(sources, userId, recipient))) throw new CannotMessageUserError(otherId)
        }
        const opened = await this.dms.open(userId, otherId)
        if (opened.created || opened.reopened) {
            const change = opened.created ? 'created' : 'reopened'
            this.events.publish(new DmChangedEvent(userId, opened.channelId, change, otherId))
        }
        return { channelId: opened.channelId }
    }
}

/**
 * Closes a DM of mine on my side (D-244): it leaves my list, and its unread
 * no longer counts, until a message comes after. Closed already: nothing
 * changes. Someone else's, or none: not found.
 */
@CommandHandler(CloseDmCommand)
export class CloseDmHandler implements ICommandHandler<CloseDmCommand> {
    constructor(
        @Inject(DM_REPOSITORY) private readonly dms: DmRepositoryPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, channelId }: CloseDmCommand): Promise<void> {
        const pair = await this.dms.find(channelId)
        if (!pair?.userIds.includes(userId)) throw new DmNotFoundError(channelId)
        const closed = await this.dms.close(userId, channelId)
        if (closed === null) throw new DmNotFoundError(channelId)
        const otherId = pair.userIds.find((id) => id !== userId)!
        if (closed) this.events.publish(new DmChangedEvent(userId, channelId, 'closed', otherId))
    }
}

export const DM_COMMAND_HANDLERS = [OpenDmHandler, CloseDmHandler]
