import { AccessMember, channelPermissions, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { CannotMessageUserError, CannotSendError, ChannelNotFoundError, TimedOutError } from '../../domain'
import { DmAccessPort } from '../ports'

/** A server's channel the person may view, and what they may do in it. */
export interface OpenServerChannel {
    serverId: string
    /** A text channel, or a voice room, whose chat has no pins (D-213). */
    type: 'text' | 'voice'
    /** From channelPermissions: private channels, roles, the owner, a timeout. */
    permissions: bigint
    member: AccessMember
}

/** A direct message of the person (D-238): no server, no roles, no timeout. */
export interface OpenDm {
    serverId: null
    type: 'dm'
    /** DM_READING, or DM_WRITING when they may message the other one now. */
    permissions: bigint
    member: null
    /** The other one of the two. */
    otherId: string
    /** Where the person's read state starts (D-244). */
    createdAt: Date
}

/** A channel the person may view, and what they may do in it. */
export type OpenChannel = OpenServerChannel | OpenDm

/** What opening a channel reads: the server's channels, permissions, and social's DMs. */
export interface ChannelSources {
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
    dms: DmAccessPort
}

/**
 * What opening is for: `view` to read, ack, delete one's own message or take
 * one's reaction off; `write` for what reaches the other one of a DM (send,
 * edit, react, files, typing, pins), which asks social whether they may
 * still message them. A server's channel reads the same either way.
 */
export type ChannelUse = 'view' | 'write'

/** In a DM both may view, react and pin; no one manages it: each deletes only their own (D-238). */
const DM_READING = Permission.VIEW_CHANNEL
const DM_WRITING = DM_READING | Permission.SEND_MESSAGES | Permission.ATTACH_FILES | Permission.ADD_REACTIONS

/**
 * The channel `channelId`, as `userId` sees it now: a text channel, or the
 * chat of a voice room, which reads and posts as one (S-ROOM-08), in the
 * room or not; or a DM of theirs (D-238). Anyone who may not view it learns
 * only "not found" (NFR-SEC-05): no such channel, its server gone, not a
 * member, a private channel, someone else's DM.
 *
 * Reads the permission cache (PERMISSION_CHECKER): a role or a timeout given a
 * moment ago reaches it once servers has told the cache (D-146). A DM asks
 * social (DM_ACCESS): its two people always read it; for `write`, whether
 * the person may still message the other one.
 */
export async function openChannel(
    { channels, checker, dms }: ChannelSources,
    channelId: string,
    userId: string,
    now: Date,
    use: ChannelUse = 'view'
): Promise<OpenChannel> {
    const serverId = await channels.serverIdOf(channelId)
    if (!serverId) return openDm(dms, channelId, userId, use)
    const access = await checker.access(serverId, userId)
    const channel = access?.server.channels.find((candidate) => candidate.id === channelId)
    if (!access || !channel) throw new ChannelNotFoundError(channelId)

    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new ChannelNotFoundError(channelId)
    return { serverId, type: channel.type, permissions, member: access.member }
}

/** A DM of `userId`, or not found: no such channel, or not one of its two. */
async function openDm(dms: DmAccessPort, channelId: string, userId: string, use: ChannelUse): Promise<OpenDm> {
    const conversation = await dms.conversation(channelId)
    if (!conversation?.userIds.includes(userId)) throw new ChannelNotFoundError(channelId)
    const otherId = conversation.userIds.find((id) => id !== userId)!
    const writing = use === 'write' && (await dms.canMessage(userId, channelId))
    return {
        serverId: null,
        type: 'dm',
        permissions: writing ? DM_WRITING : DM_READING,
        member: null,
        otherId,
        createdAt: conversation.createdAt
    }
}

/**
 * In a DM, pass only someone who may still message the other one
 * (REQ-SOCIAL-04, D-238), for what reaches them: the same answer for every
 * reason. A server's channel passes: its permissions decide.
 */
export function requireMessaging(channel: OpenChannel): void {
    if (channel.type === 'dm' && (channel.permissions & Permission.SEND_MESSAGES) === 0n)
        throw new CannotMessageUserError(channel.otherId)
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
 * (appendix B, step 1), which channelPermissions has already applied. In a
 * DM, someone who may no longer message the other one is told so instead.
 */
export function requireSending(channel: OpenChannel, now: Date): void {
    requireMessaging(channel)
    const { permissions, member } = channel
    if ((permissions & Permission.SEND_MESSAGES) !== 0n || !member) return
    if (member.timeoutUntil && member.timeoutUntil.getTime() > now.getTime())
        throw new TimedOutError(member.timeoutUntil)
    throw new CannotSendError()
}

/**
 * Whether the person is timed out in this channel's server now. The owner
 * and ADMINISTRATOR are never held back by one (appendix B, step 1): they
 * keep MANAGE_MESSAGES, which channelPermissions takes from everyone else
 * timed out. A DM has no timeout.
 */
export function timedOutUntil({ permissions, member }: OpenChannel, now: Date): Date | null {
    if (!member || (permissions & Permission.MANAGE_MESSAGES) !== 0n) return null
    if (!member.timeoutUntil || member.timeoutUntil.getTime() <= now.getTime()) return null
    return member.timeoutUntil
}
