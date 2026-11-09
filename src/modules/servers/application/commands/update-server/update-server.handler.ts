import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { planUpdateServer, ServerNotFoundError } from '../../../domain'
import { SERVER_REPOSITORY, ServerRepositoryPort } from '../../ports'
import { UpdateServerCommand } from './update-server.command'

/**
 * Name and welcome channel (MANAGE_SERVER), decided under the server row's
 * lock like the channel list (ServerRepositoryPort.changeLayout), so a
 * welcome channel deleted meanwhile is never chosen. Neither is in the
 * permission cache, which is left alone.
 */
@CommandHandler(UpdateServerCommand)
export class UpdateServerHandler implements ICommandHandler<UpdateServerCommand> {
    constructor(@Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort) {}

    async execute({ userId, serverId, edit }: UpdateServerCommand): Promise<void> {
        const now = new Date()
        const result = await this.servers.changeLayout(serverId, userId, (state) => planUpdateServer(state, edit, now))
        if (!result) throw new ServerNotFoundError(serverId)
    }
}
