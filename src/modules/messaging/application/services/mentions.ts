import { Permission, PermissionCheckerPort } from '@/modules/permissions'
import type { PresencePort } from '@/modules/realtime'
import { MembershipPort, RoleDirectoryPort } from '@/modules/servers'
import { decideMentions, isMessageContent, MessageMentions, MessageRuleError, rolesNamedIn } from '../../domain'
import { OpenChannel, viewersOf } from './channel-access'

/** A text to send, or to save over an old one, in a channel its author may post in. */
export interface MentionWork {
    channelId: string
    channel: OpenChannel
    authorId: string
    content: string
    /** Who wrote the regular message this one answers, deleted or not (D-39); null if it answers none. */
    answeredAuthorId: string | null
    now: Date
}

/**
 * The text as it is kept and what it may mention (REQ-MSG-03): the roles it
 * names looked up in its server (one read, only when it names some),
 * @everyone, @here and any role for MENTION_EVERYONE. A role it may not mention
 * becomes its name as words, which can make the text longer: past 2000
 * characters it is refused like a text too long (`length`), before anything
 * is counted. The people are only candidates: `reachingViewers` keeps those
 * who see the channel. A DM has no roles and no one may mention everyone
 * there (D-238): role tokens and @everyone / @here stay as written, as words.
 */
export async function keptText(
    roles: RoleDirectoryPort,
    { channel, authorId, content, answeredAuthorId }: MentionWork
): Promise<{ content: string; mentions: MessageMentions }> {
    const named = rolesNamedIn(content)
    const decided = decideMentions(content, {
        authorId,
        mayMentionEveryone: (channel.permissions & Permission.MENTION_EVERYONE) !== 0n,
        roles: named.length && channel.serverId ? await roles.rolesOf(channel.serverId, named) : [],
        answeredAuthorId
    })
    if (!isMessageContent(decided.content)) throw new MessageRuleError('length')
    return decided
}

/** What finding whom a message reaches reads: permissions, presence (@here), the server's members. */
export interface Reach {
    checker: PermissionCheckerPort
    presence: PresencePort
    membership: MembershipPort
}

/**
 * The mentions with a mention row only for those who may view the channel
 * now (D-164): one no one else can see the message for is told nothing.
 * @here reaches those who view it and are not offline to others as it is
 * sent, away and do not disturb included, never the sender (D-166): the
 * people online anywhere are first narrowed to the server's members in one
 * read, then each one's permissions read. Presence that cannot be read
 * reaches no one. `heldHere`: an edit of a message whose @here already
 * reached people keeps them (D-176). One permission read per person, so it
 * runs once the message is counted. In a DM, only the other one of the two
 * can be reached (D-238), and nothing is read.
 */
export async function reachingViewers(
    { checker, presence, membership }: Reach,
    { channelId, channel, authorId, now }: MentionWork,
    mentions: MessageMentions,
    heldHere?: string[]
): Promise<MessageMentions> {
    const { userIds } = mentions
    if (channel.type === 'dm') return { ...mentions, userIds: userIds.filter((id) => id === channel.otherId) }
    const viewers = userIds.length ? await viewersOf(checker, channel.serverId, channelId, userIds, now) : []
    if (!mentions.here) return { ...mentions, userIds: viewers }
    if (heldHere) return { ...mentions, userIds: viewers, hereUserIds: heldHere }
    const online = [...(await presence.everyoneShown()).keys()].filter((id) => id !== authorId)
    const members = online.length ? await membership.membersAmong(channel.serverId, online) : []
    const here = members.length ? await viewersOf(checker, channel.serverId, channelId, members, now) : []
    return { ...mentions, userIds: viewers, hereUserIds: here }
}
