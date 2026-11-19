import { AccessMember, AccessServer, channelPermissions, Permission } from '@/modules/permissions'
import { MembershipPort } from '@/modules/servers'
import { ChannelReadState, ReadStateRepositoryPort, readFloor } from '../../domain'

/** A channel's read state as the API gives it: with its server, so the rail can add up each server (C-05). */
export interface ReadStateView extends ChannelReadState {
    serverId: string
}

/**
 * The channels of a server the member may view now, text channels and the
 * chat of voice rooms, in the server's order: those whose messages reach
 * their sockets (D-163), so whose unread they keep. The rule of the realtime
 * module's serverRooms.
 */
export function viewableChannels(server: AccessServer, member: AccessMember, now: Date): string[] {
    return server.channels
        .filter((channel) => (channelPermissions(server, member, channel, now) & Permission.VIEW_CHANNEL) !== 0n)
        .map((channel) => channel.id)
}

/** When the person joined the server, or null when they are no longer in it. */
export async function joinedAt(membership: MembershipPort, userId: string, serverId: string): Promise<Date | null> {
    const found = (await membership.membershipsOf(userId)).find((one) => one.serverId === serverId)
    return found?.joinedAt ?? null
}

/** The person's state in these channels of one server: from when they joined it, with the roles they hold there. */
export async function readStatesIn(
    readStates: ReadStateRepositoryPort,
    serverId: string,
    member: AccessMember,
    joined: Date,
    channelIds: string[]
): Promise<ReadStateView[]> {
    const floorId = readFloor(joined)
    const states = await readStates.states(
        member.userId,
        member.roleIds,
        channelIds.map((channelId) => ({ channelId, floorId }))
    )
    return states.map((state) => ({ serverId, ...state }))
}
