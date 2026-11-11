import { Inject, Logger } from '@nestjs/common'
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { CURRENT_PASSWORD, CurrentPasswordPort } from '@/modules/auth'
import { PERMISSION_CACHE, PERMISSION_CHECKER, PermissionCachePort, PermissionCheckerPort } from '@/modules/permissions'
import {
    MAX_SERVERS_PER_USER,
    MaxServersReachedError,
    planDeleteServer,
    planForgetDeletedMember,
    planLeave,
    planTransferOwnership,
    planUpdateServer,
    purgeDeletedBefore,
    SERVER_REPOSITORY,
    ServerNotFoundError,
    serverPlan,
    ServerRepositoryPort
} from '../../../domain'
import { FILE_CLEANUP, FileCleanupPort, ICON_STORAGE, IconStoragePort } from '../../ports'
import { ChangeLayout } from '../../services/change-layout'
import { ChangeMembership } from '../../services/change-membership'
import { forgetFile } from '../../services/forget-file'
import { requireServerPermission } from '../../services/require-permission'
import {
    CleanUpServersCommand,
    CreateServerCommand,
    DeleteServerCommand,
    ForgetDeletedMemberCommand,
    LeaveServerCommand,
    RemoveServerIconCommand,
    TransferOwnershipCommand,
    UpdateServerCommand,
    UploadServerIconCommand
} from './server.commands'

/** How many leftover memberships, and how many deleted servers, one clean-up run handles; the next run takes the rest. */
const CLEAN_UP_BATCH = 200

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

/** Out of the server (REQ-SRV-05); the owner hands it over first. */
@CommandHandler(LeaveServerCommand)
export class LeaveServerHandler extends ChangeMembership implements ICommandHandler<LeaveServerCommand> {
    async execute({ userId, serverId }: LeaveServerCommand): Promise<void> {
        await this.change(serverId, userId, null, (state) => planLeave(state))
    }
}

/**
 * Gone for every member at once (REQ-SRV-05): its invites answer
 * INVITE_INVALID from now, as every read skips a deleted server. The row and
 * everything in it go for good 30 days later (CleanUpServersHandler).
 */
@CommandHandler(DeleteServerCommand)
export class DeleteServerHandler extends ChangeMembership implements ICommandHandler<DeleteServerCommand> {
    async execute({ userId, serverId, typedName }: DeleteServerCommand): Promise<void> {
        await this.change(serverId, userId, null, (state) => planDeleteServer(state, typedName))
    }
}

/**
 * Hand the server to another member (REQ-SRV-05, D-91), proven with the
 * owner's password first: a session alone is not enough to give everything
 * away. The auth module checks it (D-160), counting wrong ones as it does.
 */
@CommandHandler(TransferOwnershipCommand)
export class TransferOwnershipHandler extends ChangeMembership implements ICommandHandler<TransferOwnershipCommand> {
    constructor(
        @Inject(SERVER_REPOSITORY) servers: ServerRepositoryPort,
        @Inject(PERMISSION_CACHE) cache: PermissionCachePort,
        @Inject(CURRENT_PASSWORD) private readonly passwords: CurrentPasswordPort
    ) {
        super(servers, cache)
    }

    async execute({ userId, serverId, toUserId, password }: TransferOwnershipCommand): Promise<void> {
        await this.passwords.confirm(userId, password)
        await this.change(serverId, userId, toUserId, (state, now) => planTransferOwnership(state, toUserId, now))
    }
}

/**
 * What a deleted account leaves in one server (D-76): they go, and a server
 * they owned alone is deleted. One they owned with others in it stays, and
 * is reported: asking to delete the account checks again after the request
 * and revokes the invites twice (D-121, L9 review), so only a join through
 * an invite made in the moment before that second revoke could leave one.
 *
 * @returns whether anything changed
 */
@CommandHandler(ForgetDeletedMemberCommand)
export class ForgetDeletedMemberHandler
    extends ChangeMembership
    implements ICommandHandler<ForgetDeletedMemberCommand>
{
    private readonly logger = new Logger(ForgetDeletedMemberHandler.name)

    async execute({ userId, serverId }: ForgetDeletedMemberCommand): Promise<boolean> {
        const writes = await this.change(serverId, userId, null, (state) => planForgetDeletedMember(state))
        if (writes.length === 0) {
            this.logger.warn(`Deleted account ${userId} still owns server ${serverId}, which has other members`)
        }
        return writes.length > 0
    }
}

/**
 * Daily (src/maintenance): first what a lost AccountDeletedEvent left
 * behind, then the servers deleted 30 days ago, for good, with their icons.
 * Nothing to tell the permission cache: a server leaves it the moment it is
 * deleted, and each leftover goes through ForgetDeletedMemberCommand.
 *
 * The icons are queued before the rows go, as the users sweep does with
 * avatars: the row is the only record of the key, so a queue that fails
 * leaves the servers for the next run (a file queued twice is one job).
 */
@CommandHandler(CleanUpServersCommand)
export class CleanUpServersHandler implements ICommandHandler<CleanUpServersCommand> {
    private readonly logger = new Logger(CleanUpServersHandler.name)

    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(FILE_CLEANUP) private readonly cleanup: FileCleanupPort,
        private readonly commandBus: CommandBus
    ) {}

    async execute({ now }: CleanUpServersCommand): Promise<{ forgotten: number; purged: number }> {
        let forgotten = 0
        for (const { serverId, userId } of await this.servers.leftoverMemberships(CLEAN_UP_BATCH)) {
            try {
                const changed: boolean = await this.commandBus.execute(new ForgetDeletedMemberCommand(userId, serverId))
                if (changed) forgotten++
            } catch (error) {
                // Deleted meanwhile; anything else is tried again tomorrow.
                if (!(error instanceof ServerNotFoundError)) {
                    this.logger.error(`Could not remove deleted account ${userId} from server ${serverId}`, error)
                }
            }
        }

        const deleted = await this.servers.deletedBefore(purgeDeletedBefore(now), CLEAN_UP_BATCH)
        for (const { iconKey } of deleted) if (iconKey) await this.cleanup.deleteFileLater(iconKey)
        await this.servers.purge(deleted.map((server) => server.serverId))
        return { forgotten, purged: deleted.length }
    }
}

export const SERVER_COMMAND_HANDLERS = [
    CreateServerHandler,
    UpdateServerHandler,
    UploadServerIconHandler,
    RemoveServerIconHandler,
    LeaveServerHandler,
    DeleteServerHandler,
    TransferOwnershipHandler,
    ForgetDeletedMemberHandler,
    CleanUpServersHandler
]
