import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { DirectoryUser, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { isHidden, LimitsUnavailableError } from '@/shared/domain'
import { RateLimitState } from '@/shared/types/rate-limit.type'
import {
    AlreadyFriendsError,
    CannotMessageUserError,
    decideRelationship,
    FALLBACK_TIME_ZONE,
    FriendRequestLimitError,
    FriendRequestNotFoundError,
    FriendRequestPendingError,
    nextRequestDay,
    PersonNotFoundError,
    RelationshipAction,
    RELATIONSHIP_REPOSITORY,
    RelationshipRefusal,
    RelationshipRepositoryPort,
    RelationshipWrite,
    requestDayOf
} from '../../domain'
import { RelationshipChangedEvent } from '../events/relationship-changed.event'
import { SOCIAL_LIMIT, SocialLimitPort } from '../ports'
import { FRIEND_REQUESTS_PER_PERSON_DAY } from '../rate-limits'

/** What changing a relationship needs. */
export interface RelationshipSources {
    relationships: RelationshipRepositoryPort
    users: UserDirectoryPort
    limit: SocialLimitPort
    events: EventBus
}

/**
 * Whom an action may name (D-242, D-243): never oneself; for a request, an
 * accept or a block, a completed account not deleted nor waiting to be;
 * for removing and unblocking, any account not deleted for good, so a
 * friend waiting to be deleted can still be let go.
 */
async function personFor(
    users: UserDirectoryPort,
    actorId: string,
    other: DirectoryUser | string,
    action: RelationshipAction
): Promise<DirectoryUser> {
    const otherId = typeof other === 'string' ? other : other.id
    const found = otherId === actorId ? null : typeof other === 'string' ? await users.findById(otherId) : other
    const letGo = action.kind === 'remove' || action.kind === 'unblock'
    if (!found || found.deletedAt || (!letGo && (!found.completedAt || isHidden(found)))) {
        throw new PersonNotFoundError(otherId)
    }
    return found
}

/** The counter's answer, or nothing while it cannot be reached: requests go on uncounted then (D-242, as messages). */
async function unlessDown(call: () => Promise<RateLimitState>): Promise<RateLimitState | undefined> {
    try {
        return await call()
    } catch (error) {
        if (error instanceof LimitsUnavailableError) return undefined
        throw error
    }
}

function refusal(reason: RelationshipRefusal, otherId: string, retryAt: () => number): Error {
    switch (reason) {
        case 'blocked':
            return new CannotMessageUserError(otherId)
        case 'pending':
            return new FriendRequestPendingError(otherId)
        case 'friends':
            return new AlreadyFriendsError(otherId)
        case 'no_request':
            return new FriendRequestNotFoundError(otherId)
        case 'limit':
            return new FriendRequestLimitError(retryAt())
    }
}

/**
 * One person acting on their relationship with another (REQ-SOCIAL-01,
 * REQ-SOCIAL-03, D-237): checks whom it names, counts a request against the
 * sender's day before writing (taken back when it turns out not to be a new
 * request: answering theirs, asking again, a refusal), lets the pure rules
 * decide under the pair's lock, and once committed, when something was
 * written, publishes RelationshipChangedEvent. What was written, or throws
 * the refusal.
 */
export async function changeRelationship(
    { relationships, users, limit, events }: RelationshipSources,
    actorId: string,
    other: DirectoryUser | string,
    action: RelationshipAction,
    now: Date = new Date()
): Promise<RelationshipWrite> {
    const person = await personFor(users, actorId, other, action)
    const zone =
        action.kind === 'request' ? ((await users.timeZoneOf(actorId)) ?? FALLBACK_TIME_ZONE) : FALLBACK_TIME_ZONE
    const subject = `${actorId}:${requestDayOf(now, zone)}`
    const counted =
        action.kind === 'request'
            ? await unlessDown(() => limit.hit(FRIEND_REQUESTS_PER_PERSON_DAY, subject))
            : undefined
    const takeBack = async () => {
        if (counted) await limit.release(FRIEND_REQUESTS_PER_PERSON_DAY, subject)
    }

    let change
    try {
        change = await relationships.change(
            actorId,
            person.id,
            (state) => decideRelationship(state, action, !counted?.limited),
            now
        )
    } catch (error) {
        await takeBack()
        throw error
    }
    const { decision } = change
    if (!('write' in decision) || decision.write !== 'request') await takeBack()
    if ('refused' in decision) {
        throw refusal(decision.refused, person.id, () =>
            Math.max(1, Math.ceil((nextRequestDay(now, zone).getTime() - now.getTime()) / 1000))
        )
    }
    if (decision.write !== 'nothing') {
        events.publish(new RelationshipChangedEvent(actorId, person.id, change.before, change.after, decision))
    }
    return decision
}

/** What every relationship and block handler shares: its ports, as changeRelationship reads them. */
export abstract class RelationshipHandler {
    protected readonly sources: RelationshipSources

    constructor(
        @Inject(RELATIONSHIP_REPOSITORY) relationships: RelationshipRepositoryPort,
        @Inject(USER_DIRECTORY) users: UserDirectoryPort,
        @Inject(SOCIAL_LIMIT) limit: SocialLimitPort,
        events: EventBus
    ) {
        this.sources = { relationships, users, limit, events }
    }
}
