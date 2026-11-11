import { Inject, Logger } from '@nestjs/common'
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { AccountDeletedEvent } from '@/modules/users'
import { SERVER_REPOSITORY, ServerNotFoundError, ServerRepositoryPort } from '../../../domain'
import { ForgetDeletedMemberCommand } from '../../commands/server/server.commands'

/**
 * An account's 14 days are over (D-76): out of every server it was in, and a
 * server it owned alone goes with it. One command per server, so each takes
 * that server's lock and tells the permission cache like any other leave.
 * Then the bans held against it go, with their reasons (D-162). A failure is
 * logged; the daily clean-up (CleanUpServersHandler) finds what is left and
 * finishes it.
 */
@EventsHandler(AccountDeletedEvent)
export class ForgetDeletedAccountHandler implements IEventHandler<AccountDeletedEvent> {
    private readonly logger = new Logger(ForgetDeletedAccountHandler.name)

    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        private readonly commandBus: CommandBus
    ) {}

    async handle({ userId }: AccountDeletedEvent): Promise<void> {
        for (const serverId of await this.servers.serverIdsOf(userId)) {
            try {
                await this.commandBus.execute(new ForgetDeletedMemberCommand(userId, serverId))
            } catch (error) {
                // Deleted meanwhile: nothing left to do there.
                if (error instanceof ServerNotFoundError) continue
                this.logger.error(`Could not remove deleted account ${userId} from server ${serverId}`, error)
            }
        }
        try {
            await this.servers.forgetBansOf(userId)
        } catch (error) {
            this.logger.error(`Could not forget the bans of deleted account ${userId}`, error)
        }
    }
}

export const SERVER_EVENT_HANDLERS = [ForgetDeletedAccountHandler]
