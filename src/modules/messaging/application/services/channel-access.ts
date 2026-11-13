import { AccessMember, channelPermissions, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { CannotSendError, ChannelNotFoundError, TimedOutError } from '../../domain'

/** A text channel the person may view, and what they may do in it. */
export interface OpenChannel {
    serverId: string
    /** From channelPermissions: private channels, roles, the owner, a timeout. */
    permissions: bigint
    member: AccessMember
}

/**
 * The text channel `channelId`, as `userId` sees it now. Anyone who may not
 * view it learns only "not found" (NFR-SEC-05): no such channel, its server
 * gone, not a member, a private channel, or a voice room (no chat before M4).
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
    if (!access || channel?.type !== 'text') throw new ChannelNotFoundError(channelId)

    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new ChannelNotFoundError(channelId)
    return { serverId, permissions, member: access.member }
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
