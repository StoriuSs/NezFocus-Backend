import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { DmConversation, LAST_MESSAGES, LastMessagesPort } from '@/modules/messaging'
import { PRESENCE, PresencePort } from '@/modules/realtime'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    DM_REPOSITORY,
    DmPair,
    DmRepositoryPort,
    isShownDm,
    RELATIONSHIP_REPOSITORY,
    RelationshipRepositoryPort
} from '../../../domain'
import { mayReach, recipientOf } from '../../services/dm-reach'
import { DmView, dmViews, DmViewSources } from '../../services/dm-views'
import {
    CanMessageInDmQuery,
    GetDmConversationQuery,
    GetDmQuery,
    ListDmChannelIdsQuery,
    ListMyDmsQuery,
    ListShownDmsQuery
} from './dm.queries'

const conversationOf = (pair: DmPair): DmConversation => ({
    channelId: pair.channelId,
    userIds: pair.userIds,
    createdAt: pair.createdAt
})

/** What the view handlers read: the rows, who may be messaged, presence, pictures, last messages. */
abstract class DmReader {
    protected readonly views: DmViewSources

    constructor(
        @Inject(DM_REPOSITORY) protected readonly dms: DmRepositoryPort,
        @Inject(RELATIONSHIP_REPOSITORY) relationships: RelationshipRepositoryPort,
        @Inject(MEMBERSHIP) membership: MembershipPort,
        @Inject(USER_DIRECTORY) users: UserDirectoryPort,
        @Inject(PRESENCE) presence: PresencePort,
        @Inject(LAST_MESSAGES) lastMessages: LastMessagesPort
    ) {
        this.views = { relationships, membership, users, presence, lastMessages }
    }
}

/** Every DM of mine shown in my list (D-244), with whom, whether I may write, the last message. */
@QueryHandler(ListMyDmsQuery)
export class ListMyDmsHandler extends DmReader implements IQueryHandler<ListMyDmsQuery> {
    async execute({ userId }: ListMyDmsQuery): Promise<DmView[]> {
        return dmViews(this.views, userId, await this.dms.entriesOf(userId), true)
    }
}

/** One DM of mine, shown in my list or not. */
@QueryHandler(GetDmQuery)
export class GetDmHandler extends DmReader implements IQueryHandler<GetDmQuery> {
    async execute({ userId, channelId }: GetDmQuery): Promise<DmView | null> {
        const entry = await this.dms.entryOf(userId, channelId)
        if (!entry) return null
        const [view] = await dmViews(this.views, userId, [entry])
        return view!
    }
}

@QueryHandler(GetDmConversationQuery)
export class GetDmConversationHandler implements IQueryHandler<GetDmConversationQuery> {
    constructor(@Inject(DM_REPOSITORY) private readonly dms: DmRepositoryPort) {}

    async execute({ channelId }: GetDmConversationQuery): Promise<DmConversation | null> {
        const pair = await this.dms.find(channelId)
        return pair && conversationOf(pair)
    }
}

/**
 * Whether one of a DM's two may message the other now (REQ-SOCIAL-04,
 * mayMessage): false for anyone else, and when the other account is gone.
 * Read for every message written in a DM, and each typing signal.
 */
@QueryHandler(CanMessageInDmQuery)
export class CanMessageInDmHandler implements IQueryHandler<CanMessageInDmQuery> {
    constructor(
        @Inject(DM_REPOSITORY) private readonly dms: DmRepositoryPort,
        @Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async execute({ userId, channelId }: CanMessageInDmQuery): Promise<boolean> {
        const pair = await this.dms.find(channelId)
        if (!pair?.userIds.includes(userId)) return false
        const recipient = await recipientOf(this.users, userId, pair.userIds.find((id) => id !== userId)!)
        if (!recipient) return false
        const sources = { relationships: this.relationships, membership: this.membership, users: this.users }
        return mayReach(sources, userId, recipient)
    }
}

/** The person's DMs shown in their list (isShownDm, D-244): the last message of each read once for all. */
@QueryHandler(ListShownDmsQuery)
export class ListShownDmsHandler implements IQueryHandler<ListShownDmsQuery> {
    constructor(
        @Inject(DM_REPOSITORY) private readonly dms: DmRepositoryPort,
        @Inject(LAST_MESSAGES) private readonly lastMessages: LastMessagesPort
    ) {}

    async execute({ userId }: ListShownDmsQuery): Promise<DmConversation[]> {
        const entries = await this.dms.entriesOf(userId)
        const closed = entries.filter((entry) => entry.closedAt)
        const last = await this.lastMessages.lastMessagesOf(closed.map((entry) => entry.channelId))
        const lastAt = new Map(last.map((message) => [message.channelId, message.createdAt]))
        return entries
            .filter((entry) => isShownDm(entry.closedAt, lastAt.get(entry.channelId) ?? null))
            .map((entry) => ({
                channelId: entry.channelId,
                userIds: [userId, entry.other.id].sort() as [string, string],
                createdAt: entry.createdAt
            }))
    }
}

@QueryHandler(ListDmChannelIdsQuery)
export class ListDmChannelIdsHandler implements IQueryHandler<ListDmChannelIdsQuery> {
    constructor(@Inject(DM_REPOSITORY) private readonly dms: DmRepositoryPort) {}

    execute({ userId }: ListDmChannelIdsQuery): Promise<string[]> {
        return this.dms.channelIdsOf(userId)
    }
}

export const DM_QUERY_HANDLERS = [
    ListMyDmsHandler,
    GetDmHandler,
    GetDmConversationHandler,
    CanMessageInDmHandler,
    ListShownDmsHandler,
    ListDmChannelIdsHandler
]
