import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { serverIdsIn } from '@/modules/realtime/domain'
import { RoomMoves } from '../../services/room-moves'
import { SettleRoomsCommand } from './settle-rooms.command'

/**
 * Closes the gap between the handshake, which read the rooms, and the socket
 * joining them (ARCHITECTURE 3.1, D-178): a change committed in between
 * moved only the sockets already in the rooms, so this one could keep a
 * channel it may no longer view, or miss one it may now. Once joined, it is
 * in `user:<id>`, where every later move finds it; here it is moved again in
 * the servers it was put in and those it is in now (one left meanwhile, one
 * joined meanwhile). A failure leaves the rooms the handshake gave, logged.
 */
@CommandHandler(SettleRoomsCommand)
export class SettleRoomsHandler implements ICommandHandler<SettleRoomsCommand> {
    private readonly logger = new Logger(SettleRoomsHandler.name)

    constructor(
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        private readonly roomMoves: RoomMoves
    ) {}

    async execute({ userId, rooms }: SettleRoomsCommand): Promise<void> {
        try {
            const servers = new Set([...serverIdsIn(rooms), ...(await this.membership.serverIdsOf(userId))])
            const results = await Promise.allSettled(
                [...servers].map((serverId) => this.roomMoves.moveInto(serverId, [userId]))
            )
            const failed = results.filter((result) => result.status === 'rejected').length
            if (failed > 0) this.logger.warn(`Rooms of ${userId} not settled in ${failed} server(s)`)
        } catch (error) {
            this.logger.warn(`Rooms of ${userId} not settled: ${(error as Error)?.message}`)
        }
    }
}
