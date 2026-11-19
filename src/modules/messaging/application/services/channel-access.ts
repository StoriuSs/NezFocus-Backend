import { AccessMember, channelPermissions, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { CannotSendError, ChannelNotFoundError, TimedOutError } from '../../domain'

/** A channel the person may view, and what they may do in it. */
export interface OpenChannel {
    serverId: string
    /** A text channel, or a voice room, whose chat has no pins (D-213). */
    type: 'text' | 'voice'
    /** From channelPermissions: private channels, roles, the owner, a timeout. */
    permissions: bigint
    member: AccessMember
}

/**
 * The channel `channelId`, as `userId` sees it now: a text channel, or the
 * chat of a voice room, which reads and posts as one (S-ROOM-08), in the
 * room or not. Anyone who may not view it learns only "not found" (NFR-SEC-05): no
 * such channel, its server gone, not a member, a private channel.
 *
 * Reads the permission cache (PERMISSION_CHECKER): a role or a timeout given a
 * moment ago reaches it once servers has told the cache (D-146).
 */
export async function openChannel(
    channels: ChannelDirectoryPort,
    checker: PermissionCheckerPort,
    channelId: string,
    userId: string,
    now: Date
): Promise<OpenChannel> {
    const serverId = await channels.serverIdOf(channelId)
    if (!serverId) throw new ChannelNotFoundError(channelId)
    const access = await checker.access(serverId, userId)
    const channel = access?.server.channels.find((candidate) => candidate.id === channelId)
    if (!access || !channel) throw new ChannelNotFoundError(channelId)

    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new ChannelNotFoundError(channelId)
    return { serverId, type: channel.type, permissions, member: access.member }
}

/**
 * Those among `userIds` who may view the channel now (text or voice), in the order
 * given: members whose roles, the channel's privacy and the owner let them
 * (D-17); a timed-out member still views (appendix B). Anyone else is left
 * out: a mention of them reaches no one (D-164).
 */
export async function viewersOf(
    checker: PermissionCheckerPort,
    serverId: string,
    channelId: string,
    userIds: string[],
    now: Date
): Promise<string[]> {
    const views = await Promise.all(
        userIds.map(async (userId) => {
            const access = await checker.access(serverId, userId)
            const channel = access?.server.channels.find((candidate) => candidate.id === channelId)
            if (!access || !channel) return false
            return (channelPermissions(access.server, access.member, channel, now) & Permission.VIEW_CHANNEL) !== 0n
        })
    )
    return userIds.filter((_, index) => views[index])
}

/**
 * Pass only someone who may post in the open channel (REQ-ROLE-03, 04). A
 * timeout says so, and until when, before any other reason: the composer
 * shows it (D-54). The owner and ADMINISTRATOR post through a timeout
 * (appendix B, step 1), which channelPermissions has already applied.
 */
export function requireSending({ permissions, member }: OpenChannel, now: Date): void {
    if ((permissions & Permission.SEND_MESSAGES) !== 0n) return
    if (member.timeoutUntil && member.timeoutUntil.getTime() > now.getTime())
        throw new TimedOutError(member.timeoutUntil)
    throw new CannotSendError()
}

/**
 * Whether the person is timed out in this channel's server now. The owner
 * and ADMINISTRATOR are never held back by one (appendix B, step 1): they
 * keep MANAGE_MESSAGES, which channelPermissions takes from everyone else
 * timed out.
 */
export function timedOutUntil({ permissions, member }: OpenChannel, now: Date): Date | null {
    if ((permissions & Permission.MANAGE_MESSAGES) !== 0n) return null
    if (!member.timeoutUntil || member.timeoutUntil.getTime() <= now.getTime()) return null
    return member.timeoutUntil
}
