import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { TICKET_TTL_SECONDS } from '@/modules/realtime/domain'
import { TICKET_STORE, TicketStorePort } from '../../ports'
import { IssueTicketCommand } from './issue-ticket.command'

/**
 * A ticket for the session the request came in (D-13). The route's guard has
 * already checked that session is live and the account usable (completed,
 * not waiting to be deleted), so a ticket is only ever sold to one that is.
 */
@CommandHandler(IssueTicketCommand)
export class IssueTicketHandler implements ICommandHandler<IssueTicketCommand> {
    constructor(@Inject(TICKET_STORE) private readonly tickets: TicketStorePort) {}

    async execute({ userId, sessionId }: IssueTicketCommand): Promise<{ ticket: string; expiresInSeconds: number }> {
        const ticket = await this.tickets.issue({ userId, sessionId })
        return { ticket, expiresInSeconds: TICKET_TTL_SECONDS }
    }
}
