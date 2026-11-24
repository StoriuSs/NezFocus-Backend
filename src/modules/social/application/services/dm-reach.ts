import { MembershipPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { isHidden } from '@/shared/domain'
import { mayMessage, RelationshipRepositoryPort } from '../../domain'

/** What deciding who may be messaged reads: friends and blocks, shared servers, the recipients' setting. */
export interface ReachSources {
    relationships: RelationshipRepositoryPort
    membership: MembershipPort
    users: UserDirectoryPort
}

/** Someone who might be written to, and whether their account is gone (deleted, or waiting to be, D-182). */
export interface Recipient {
    id: string
    gone: boolean
}

/** Whom `userId` may message among some recipients, and the two facts a DM's presence needs too. */
export interface Reach {
    /** Those they may message now. */
    messageable: Set<string>
    /** Their friends among them. */
    friends: Set<string>
    /** Those who share a server with them. */
    sharing: Set<string>
}

/**
 * Those of `recipients` whom `userId` may message now (REQ-SOCIAL-04,
 * mayMessage): the facts read once for them all, whatever their number
 * (friends, blocks both ways, servers shared, each one's setting), so a
 * list of DMs costs as much as one. An account gone is read for nothing.
 */
export async function reachOf(
    { relationships, membership, users }: ReachSources,
    userId: string,
    recipients: Recipient[]
): Promise<Reach> {
    const ids = recipients.filter((recipient) => !recipient.gone).map((recipient) => recipient.id)
    if (ids.length === 0) return { messageable: new Set(), friends: new Set(), sharing: new Set() }
    const [friends, blocked, blockers, sharing, allowing] = await Promise.all([
        relationships.friendIdsOf(userId),
        relationships.blockedBy(userId),
        relationships.blockersAmong(userId, ids),
        membership.sharingAServer(userId, ids),
        users.allowingServerMemberMessages(ids)
    ])
    const sets = {
        friends: new Set(friends),
        blocked: new Set([...blocked, ...blockers]),
        sharing: new Set(sharing),
        allowing: new Set(allowing)
    }
    const messageable = recipients.filter((recipient) =>
        mayMessage({
            gone: recipient.gone,
            blocked: sets.blocked.has(recipient.id),
            friends: sets.friends.has(recipient.id),
            sharesServer: sets.sharing.has(recipient.id),
            allowsServerMembers: sets.allowing.has(recipient.id)
        })
    )
    return {
        messageable: new Set(messageable.map((recipient) => recipient.id)),
        friends: sets.friends,
        sharing: sets.sharing
    }
}

/** Whether `userId` may message this one recipient now (reachOf). */
export async function mayReach(sources: ReachSources, userId: string, recipient: Recipient): Promise<boolean> {
    return (await reachOf(sources, userId, [recipient])).messageable.has(recipient.id)
}

/**
 * One person as a recipient, read from the directory: gone when there is no
 * such account, it is not completed, or it is deleted or waiting to be
 * (D-182, D-243). Null for oneself.
 */
export async function recipientOf(
    users: UserDirectoryPort,
    userId: string,
    otherId: string
): Promise<Recipient | null> {
    if (otherId === userId) return null
    const found = await users.findById(otherId)
    return { id: otherId, gone: !found || !found.completedAt || isHidden(found) }
}
