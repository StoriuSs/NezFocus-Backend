import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { ServerNotFoundError } from '../../../domain'
import {
    FILE_CLEANUP,
    FileCleanupPort,
    ICON_STORAGE,
    IconStoragePort,
    SERVER_REPOSITORY,
    ServerRepositoryPort
} from '../../ports'
import { forgetFile } from '../../forget-file'
import { requireServerPermission } from '../../require-permission'
import { UploadServerIconCommand } from './upload-icon.command'

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
