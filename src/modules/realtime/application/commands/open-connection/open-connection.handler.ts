import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { PRINCIPAL, PrincipalPort } from '@/modules/auth'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { serverRooms, sessionRoom, TicketInvalidError, userRoom } from '@/modules/realtime/domain'
import { TICKET_STORE, TicketStorePort } from '../../ports'
import { OpenConnectionCommand } from './open-connection.command'

/** Who a connection is, and the rooms to put it in. */
export interface OpenedConnection {
    userId: string
    sessionId: string
    rooms: string[]
}

/**
 * Lets a socket in (ARCHITECTURE 3.1 steps 2 to 4): spends its ticket, checks
 * the session that bought it has not ended since, and works out its rooms:
 * its own, its session's, each server it is in, and each text channel there
 * it may view (D-163): serverRooms, the rule L9 reuses when permissions
 * change.
 */
@CommandHandler(OpenConnectionCommand)
export class OpenConnectionHandler implements ICommandHandler<OpenConnectionCommand> {
    constructor(
        @Inject(TICKET_STORE) private readonly tickets: TicketStorePort,
        @Inject(PRINCIPAL) private readonly principals: PrincipalPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort
    ) {}

    async execute({ ticket }: OpenConnectionCommand): Promise<OpenedConnection> {
        if (!ticket) throw new TicketInvalidError()
        const holder = await this.tickets.redeem(ticket)
        if (!holder) throw new TicketInvalidError()
        // Throws when the session ended within the ticket's 30 seconds, or the
        // account went: the same answer a REST request would get.
        await this.principals.resolve(holder)

        const rooms = [userRoom(holder.userId), sessionRoom(holder.sessionId)]
        const now = new Date()
        for (const serverId of await this.membership.serverIdsOf(holder.userId)) {
            // Null: left, removed or deleted since it was listed.
            const access = await this.permissions.access(serverId, holder.userId)
            if (access) rooms.push(...serverRooms(serverId, access.server, access.member, now))
        }
        return { userId: holder.userId, sessionId: holder.sessionId, rooms }
    }
}
