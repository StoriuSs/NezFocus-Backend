import { Inject, Injectable } from '@nestjs/common'
import { PERMISSION_CHECKER, type PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, type ChannelDirectoryPort } from '@/modules/servers'
import { roomMoves, serverRooms } from '../../domain'
import { SOCKET_ROOMS, type SocketRoomsPort } from '../ports'

/**
 * Puts each person's sockets in the rooms of one server they may be in now,
 * and takes them out of the others (D-178, SRS 5.2): the same rule as when a
 * socket connects (serverRooms), decided on what PERMISSION_CHECKER answers,
 * which the servers module told to forget before the event. Someone no
 * longer in the server leaves its room and every room of its channels.
 *
 * One person's moves run one after the other on this instance, each reading
 * access when its turn comes: a role given then taken at once ends with the
 * rooms of the second, never the first read late. Another instance moving
 * the same person at the same moment is not ordered with this one (one
 * instance in production; ARCHITECTURE 3.2).
 */
@Injectable()
export class RoomMoves {
    /** The last move waited for, per person. */
    private readonly turns = new Map<string, Promise<void>>()

    constructor(
        @Inject(SOCKET_ROOMS) private readonly rooms: SocketRoomsPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort
    ) {}

    /** Every person is moved, whoever cannot be; throws after, saying how many were not. */
    async moveInto(serverId: string, userIds: string[]): Promise<void> {
        if (userIds.length === 0) return
        const channelIds = await this.channels.channelIdsOf(serverId)
        const results = await Promise.allSettled(
            userIds.map((userId) => this.inTurn(userId, () => this.moveOne(serverId, channelIds, userId)))
        )
        const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed.length > 0) {
            throw new Error(
                `${failed.length} of ${userIds.length} not moved: ${(failed[0].reason as Error)?.message ?? failed[0].reason}`
            )
        }
    }

    private async moveOne(serverId: string, channelIds: string[], userId: string): Promise<void> {
        const access = await this.permissions.access(serverId, userId)
        const allowed = access ? serverRooms(serverId, access.server, access.member, new Date()) : []
        const { leave, join } = roomMoves(serverId, channelIds, allowed)
        await this.rooms.move(userId, leave, join)
    }

    private inTurn(userId: string, work: () => Promise<void>): Promise<void> {
        const before = this.turns.get(userId) ?? Promise.resolve()
        const mine = before.catch(() => undefined).then(work)
        this.turns.set(userId, mine)
        const forget = () => {
            if (this.turns.get(userId) === mine) this.turns.delete(userId)
        }
        mine.then(forget, forget)
        return mine
    }
}
