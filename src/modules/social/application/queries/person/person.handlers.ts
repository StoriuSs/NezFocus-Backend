import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Presence, PRESENCE, PresencePort } from '@/modules/realtime'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { DirectoryUser, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { isHidden } from '@/shared/domain'
import {
    Activity,
    PersonNotFoundError,
    RELATIONSHIP_REPOSITORY,
    RelationshipRepositoryPort,
    RelationshipType
} from '../../../domain'
import { SOCIAL_LIMIT, SocialLimitPort } from '../../ports'
import { StudyActivities } from '../../services/activities'
import { findByUsername } from '../../services/find-by-username'
import { PersonView, personViews } from '../../services/relationship-views'
import { GetPersonProfileQuery, LookUpPersonQuery } from './person.queries'

/** A server we share, by name: its picture is in the reader's own list of servers (D-242). */
export interface MutualServerView {
    id: string
    name: string
}

/**
 * A person's card or profile (D-109, D-110, D-111): who they are, their bio,
 * where we stand, the servers we share in the order of mine. Their presence
 * and study activity only when we are friends or share a server (whoever
 * else sees them there); none for anyone else. An account waiting to be deleted shows as deleted
 * (D-182): no name, no bio, no servers.
 */
export interface PersonProfileView {
    user: PersonView
    bio: string | null
    presence: Presence | null
    /** What they study now (D-79, D-240): the ProfilePopover's block; null when they show nothing or it is not for me. */
    activity: Activity | null
    relationship: RelationshipType
    mutualServers: MutualServerView[]
}

/** What both reads share: the person's rows, our servers, their picture, presence and study activity. */
abstract class PersonReader {
    constructor(
        @Inject(RELATIONSHIP_REPOSITORY) private readonly relationships: RelationshipRepositoryPort,
        @Inject(USER_DIRECTORY) protected readonly users: UserDirectoryPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(PRESENCE) private readonly presence: PresencePort,
        private readonly activities: StudyActivities
    ) {}

    /** Their profile as `viewerId` sees it, or not found when the account is gone for good. */
    protected async profileOf(viewerId: string, other: DirectoryUser): Promise<PersonProfileView> {
        const hidden = isHidden(other)
        const [entry, shared] = await Promise.all([
            this.relationships.entryOf(viewerId, other.id),
            hidden ? Promise.resolve([]) : this.membership.sharedServers(viewerId, other.id)
        ])
        if (!entry) throw new PersonNotFoundError(other.id)
        const seen = !hidden && (entry.type === 'friend' || shared.length > 0)
        const [[user], shown, activity] = await Promise.all([
            personViews(this.users, [entry.person]),
            seen ? this.presence.everyoneShown() : null,
            seen ? this.activities.ofOne(other.id) : null
        ])
        return {
            user: user!,
            bio: hidden ? null : other.bio,
            presence: shown ? (shown.get(other.id) ?? 'offline') : null,
            activity,
            relationship: entry.type,
            mutualServers: shared.map(({ serverId, name }) => ({ id: serverId, name }))
        }
    }
}

/**
 * A lookup by username (D-110): counted first, 30 a minute, refused while
 * the counter cannot be reached (it stops walking the usernames, as invite
 * guesses are). Not found: no such name, oneself (the dialog says so before
 * asking), an account not completed, deleted or waiting to be. One who
 * blocked me is found as anyone (REQ-SOCIAL-01): only asking them fails.
 */
@QueryHandler(LookUpPersonQuery)
export class LookUpPersonHandler extends PersonReader implements IQueryHandler<LookUpPersonQuery> {
    constructor(
        @Inject(RELATIONSHIP_REPOSITORY) relationships: RelationshipRepositoryPort,
        @Inject(USER_DIRECTORY) users: UserDirectoryPort,
        @Inject(MEMBERSHIP) membership: MembershipPort,
        @Inject(PRESENCE) presence: PresencePort,
        activities: StudyActivities,
        @Inject(SOCIAL_LIMIT) private readonly limit: SocialLimitPort
    ) {
        super(relationships, users, membership, presence, activities)
    }

    async execute({ userId, username }: LookUpPersonQuery): Promise<PersonProfileView> {
        const other = await findByUsername(this.users, this.limit, userId, username)
        if (!other || other.id === userId || !other.completedAt || isHidden(other)) {
            throw new PersonNotFoundError(username)
        }
        return this.profileOf(userId, other)
    }
}

/** A profile (D-109): anyone with an account not deleted for good, oneself included. */
@QueryHandler(GetPersonProfileQuery)
export class GetPersonProfileHandler extends PersonReader implements IQueryHandler<GetPersonProfileQuery> {
    async execute({ userId, otherId }: GetPersonProfileQuery): Promise<PersonProfileView> {
        const other = await this.users.findById(otherId)
        if (!other || other.deletedAt || !other.completedAt) throw new PersonNotFoundError(otherId)
        return this.profileOf(userId, other)
    }
}

export const PERSON_QUERY_HANDLERS = [LookUpPersonHandler, GetPersonProfileHandler]
