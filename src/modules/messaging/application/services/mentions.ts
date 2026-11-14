import { Permission, PermissionCheckerPort } from '@/modules/permissions'
import { RoleDirectoryPort } from '@/modules/servers'
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
 * @everyone and any role for MENTION_EVERYONE. A role it may not mention
 * becomes its name as words, which can make the text longer: past 2000
 * characters it is refused like a text too long (`length`), before anything
 * is counted. The people are only candidates: `reachingViewers` keeps those
 * who see the channel.
 */
export async function keptText(
    roles: RoleDirectoryPort,
    { channel, authorId, content, answeredAuthorId }: MentionWork
): Promise<{ content: string; mentions: MessageMentions }> {
    const named = rolesNamedIn(content)
    const decided = decideMentions(content, {
        authorId,
        mayMentionEveryone: (channel.permissions & Permission.MENTION_EVERYONE) !== 0n,
        roles: named.length ? await roles.rolesOf(channel.serverId, named) : [],
        answeredAuthorId
    })
    if (!isMessageContent(decided.content)) throw new MessageRuleError('length')
    return decided
}

/**
 * The mentions with a mention row only for those who may view the channel
 * now (D-164): one no one else can see the message for is told nothing.
 * One permission read per person, so it runs once the message is counted.
 */
export async function reachingViewers(
    checker: PermissionCheckerPort,
    { channelId, channel, now }: MentionWork,
    mentions: MessageMentions
): Promise<MessageMentions> {
    const { userIds } = mentions
    const viewers = userIds.length ? await viewersOf(checker, channel.serverId, channelId, userIds, now) : []
    return { ...mentions, userIds: viewers }
}
