import { channelViewers, PermissionCheckerPort } from '@/modules/permissions'
import { MembershipPort } from '@/modules/servers'
import { MessageMentionSources } from '@/modules/notifications'
import { MessageRepositoryPort } from '../../domain'
import { MessageView } from './message-views'

/** Where mentionSourcesOf reads. */
export interface MentionSourceReaders {
    messages: MessageRepositoryPort
    membership: MembershipPort
    checker: PermissionCheckerPort
}

/**
 * Whom a saved message is about (REQ-MSG-09, D-183), each viewing its
 * channel: by name and the author it answers, from its mention rows (written
 * with only those who view it, D-164; a token naming someone else is not
 * one); @here, the list taken when it was sent (D-166); @everyone and each
 * role in effect, the members who view the channel now. The author included
 * where they are: NOTIFIER leaves them out (D-185).
 */
export async function mentionSourcesOf(
    { messages, membership, checker }: MentionSourceReaders,
    serverId: string,
    message: MessageView
): Promise<MessageMentionSources> {
    const named = new Set(message.mentionUsers.map((user) => user.id))
    const rows = await messages.mentionedIn(message.id)
    const broad = message.mentionEveryone || message.mentionRoles.length > 0
    // Who views the channel is the same whoever asks: the author's access holds the server's.
    const access = broad && message.author ? await checker.access(serverId, message.author.id) : null
    const channel = access?.server.channels.find((candidate) => candidate.id === message.channelId)
    const viewers = access && channel ? channelViewers(access.server, channel) : undefined
    const membersWith = async (roleIds?: string[]) =>
        viewers === undefined
            ? []
            : (await membership.channelMembers(serverId, { viewers, roleIds })).map((member) => member.userId)
    const [everyone, roles] = await Promise.all([
        message.mentionEveryone ? membersWith() : Promise.resolve([]),
        Promise.all(
            message.mentionRoles.map(async (role) => ({ roleId: role.id, userIds: await membersWith([role.id]) }))
        )
    ])
    return {
        users: rows.filter((userId) => named.has(userId)),
        repliedTo: rows.find((userId) => !named.has(userId)) ?? null,
        roles,
        everyone,
        here: message.mentionHereUserIds
    }
}

/** Everyone the sources name, once each. */
export const peopleOf = (sources: MessageMentionSources): string[] => [
    ...new Set([
        ...sources.users,
        ...(sources.repliedTo ? [sources.repliedTo] : []),
        ...sources.roles.flatMap((role) => role.userIds),
        ...sources.everyone,
        ...sources.here
    ])
]
