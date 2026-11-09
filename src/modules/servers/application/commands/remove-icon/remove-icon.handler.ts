import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { ServerNotFoundError } from '../../../domain'
import { FILE_CLEANUP, FileCleanupPort, SERVER_REPOSITORY, ServerRepositoryPort } from '../../ports'
import { forgetFile } from '../../forget-file'
import { requireServerPermission } from '../../require-permission'
import { RemoveServerIconCommand } from './remove-icon.command'

/** Back to the initials (MANAGE_SERVER). Without an icon it answers the same. */
@CommandHandler(RemoveServerIconCommand)
export class RemoveServerIconHandler implements ICommandHandler<RemoveServerIconCommand> {
    constructor(
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(FILE_CLEANUP) private readonly cleanup: FileCleanupPort
    ) {}

    async execute({ userId, serverId }: RemoveServerIconCommand): Promise<void> {
        await requireServerPermission(this.checker, serverId, userId, 'MANAGE_SERVER')
        const replaced = await this.servers.replaceIcon(serverId, null)
        if (!replaced) throw new ServerNotFoundError(serverId)
        await forgetFile(this.cleanup, replaced.previousIconKey)
    }
}
