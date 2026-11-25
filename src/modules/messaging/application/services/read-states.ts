import { AccessMember, AccessServer, channelPermissions, Permission } from '@/modules/permissions'
import { MembershipPort } from '@/modules/servers'
import { ChannelReadState, ReadStateRepositoryPort, readFloor } from '../../domain'

/**
 * A channel's read state as the API gives it: with its server, so the rail
 * can add up each server (C-05); null for a DM, which the 💬 badge adds up
 * (D-244).
 */
export interface ReadStateView extends ChannelReadState {
    serverId: string | null
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

/**
 * The person's state in these channels of one server, from when they joined
 * it, with the roles they hold there; or in a DM (`serverId` null, no
 * member), from when it began. Whom they blocked counts neither way (D-250).
 */
export async function readStatesIn(
    readStates: ReadStateRepositoryPort,
    userId: string,
    serverId: string | null,
    member: AccessMember | null,
    joined: Date,
    channelIds: string[],
    blockedIds: string[]
): Promise<ReadStateView[]> {
    const floorId = readFloor(joined)
    const states = await readStates.states(
        userId,
        member?.roleIds ?? [],
        channelIds.map((channelId) => ({ channelId, floorId })),
        blockedIds
    )
    return states.map((state) => ({ serverId, ...state }))
}
