import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { MAX_SERVERS_PER_USER, MaxServersReachedError, serverPlan } from '../../../domain'
import { SERVER_REPOSITORY, ServerRepositoryPort } from '../../ports'
import { CreateServerCommand } from './create-server.command'

/**
 * A new server from a template, its creator the owner and first member
 * (REQ-SRV-01, REQ-STUDY-08). Nothing to tell the permission cache: it never
 * holds a server or a membership that did not exist (D-146).
 */
@CommandHandler(CreateServerCommand)
export class CreateServerHandler implements ICommandHandler<CreateServerCommand> {
    constructor(@Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort) {}

    async execute({ userId, name, template }: CreateServerCommand): Promise<{ serverId: string }> {
        const created = await this.servers.create({
            ownerId: userId,
            name,
            plan: serverPlan(template),
            maxServers: MAX_SERVERS_PER_USER
        })
        if (!created) throw new MaxServersReachedError()
        return created
    }
}
