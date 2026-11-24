import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PRESENCE, PresencePort } from '@/modules/realtime'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { RELATIONSHIP_REPOSITORY, RelationshipRepositoryPort } from '../../../domain'
import { RelationshipView, relationshipViews, ViewSources } from '../../services/relationship-views'
import {
    GetRelationshipQuery,
    ListBlockedIdsQuery,
    ListBlockersAmongQuery,
    ListFriendIdsQuery,
    ListMyRelationshipsQuery
} from './relationship.queries'

/** What the list handlers read: the rows, pictures and presence. */
abstract class RelationshipReader {
    protected readonly views: ViewSources

    constructor(
        @Inject(RELATIONSHIP_REPOSITORY) protected readonly relationships: RelationshipRepositoryPort,
        @Inject(USER_DIRECTORY) users: UserDirectoryPort,
        @Inject(PRESENCE) presence: PresencePort
    ) {
        this.views = { users, presence }
    }
}

/** The newest first: a request just sent or a friend just made at the top until the client sorts. */
@QueryHandler(ListMyRelationshipsQuery)
export class ListMyRelationshipsHandler extends RelationshipReader implements IQueryHandler<ListMyRelationshipsQuery> {
    async execute({ userId }: ListMyRelationshipsQuery): Promise<RelationshipView[]> {
        const entries = await this.relationships.entriesOf(userId)
        entries.sort((a, b) => (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0))
        return relationshipViews(this.views, entries)
    }
}

@QueryHandler(GetRelationshipQuery)
export class GetRelationshipHandler extends RelationshipReader implements IQueryHandler<GetRelationshipQuery> {
    async execute({ userId, otherId }: GetRelationshipQuery): Promise<RelationshipView | null> {
        const entry = await this.relationships.entryOf(userId, otherId)
        if (!entry) return null
        const [view] = await relationshipViews(this.views, [entry])
        return view!
    }
}

@QueryHandler(ListFriendIdsQuery)
export class ListFriendIdsHandler implements IQueryHandler<ListFriendIdsQuery> {
    constructor(@Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort) {}

    execute({ userId }: ListFriendIdsQuery): Promise<string[]> {
        return this.relationships.friendIdsOf(userId)
    }
}

@QueryHandler(ListBlockedIdsQuery)
export class ListBlockedIdsHandler implements IQueryHandler<ListBlockedIdsQuery> {
    constructor(@Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort) {}

    execute({ userId }: ListBlockedIdsQuery): Promise<string[]> {
        return this.relationships.blockedBy(userId)
    }
}

@QueryHandler(ListBlockersAmongQuery)
export class ListBlockersAmongHandler implements IQueryHandler<ListBlockersAmongQuery> {
    constructor(@Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort) {}

    execute({ blockedId, userIds }: ListBlockersAmongQuery): Promise<string[]> {
        return this.relationships.blockersAmong(blockedId, userIds)
    }
}

export const RELATIONSHIP_QUERY_HANDLERS = [
    ListMyRelationshipsHandler,
    GetRelationshipHandler,
    ListFriendIdsHandler,
    ListBlockedIdsHandler,
    ListBlockersAmongHandler
]
