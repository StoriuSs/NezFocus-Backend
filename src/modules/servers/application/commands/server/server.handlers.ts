import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import {
    MAX_SERVERS_PER_USER,
    MaxServersReachedError,
    planUpdateServer,
    SERVER_REPOSITORY,
    ServerNotFoundError,
    serverPlan,
    ServerRepositoryPort
} from '../../../domain'
import { FILE_CLEANUP, FileCleanupPort, ICON_STORAGE, IconStoragePort } from '../../ports'
import { ChangeLayout } from '../../services/change-layout'
import { forgetFile } from '../../services/forget-file'
import { requireServerPermission } from '../../services/require-permission'
import {
    CreateServerCommand,
    RemoveServerIconCommand,
    UpdateServerCommand,
    UploadServerIconCommand
} from './server.commands'

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

/**
 * Name and welcome channel (MANAGE_SERVER), decided under the server row's
 * lock like the channel list (ServerRepositoryPort.changeLayout), so a
 * welcome channel deleted meanwhile is never chosen. Neither is in the
 * permission cache, which is left alone.
 */
@CommandHandler(UpdateServerCommand)
export class UpdateServerHandler extends ChangeLayout implements ICommandHandler<UpdateServerCommand> {
    async execute({ userId, serverId, edit }: UpdateServerCommand): Promise<void> {
        await this.change(serverId, userId, (state, now) => planUpdateServer(state, edit, now))
    }
}

/**
 * A new icon for the server (REQ-SRV-01; MANAGE_SERVER, which the owner has
 * right after creating it). The file is stored first, then swapped in; the
 * one it replaced is deleted later by the queue.
 */
@CommandHandler(UploadServerIconCommand)
export class UploadServerIconHandler implements ICommandHandler<UploadServerIconCommand> {
    constructor(
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(ICON_STORAGE) private readonly storage: IconStoragePort,
        @Inject(FILE_CLEANUP) private readonly cleanup: FileCleanupPort
    ) {}

    async execute({ userId, serverId, file }: UploadServerIconCommand): Promise<{ iconUrl: string }> {
        await requireServerPermission(this.checker, serverId, userId, 'MANAGE_SERVER')
        const iconKey = await this.storage.uploadIcon(file, serverId)

        // Not swapped in (the server was deleted meanwhile, or the database
        // failed): nothing will ever point at the new file.
        let replaced: { previousIconKey: string | null } | null
        try {
            replaced = await this.servers.replaceIcon(serverId, iconKey)
        } catch (error) {
            await this.storage.deleteFile(iconKey).catch(() => undefined)
            throw error
        }
        if (!replaced) {
            await this.storage.deleteFile(iconKey).catch(() => undefined)
            throw new ServerNotFoundError(serverId)
        }

        await forgetFile(this.cleanup, replaced.previousIconKey)
        return { iconUrl: await this.storage.getReadUrl(iconKey) }
    }
}

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

export const SERVER_COMMAND_HANDLERS = [
    CreateServerHandler,
    UpdateServerHandler,
    UploadServerIconHandler,
    RemoveServerIconHandler
]
