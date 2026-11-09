import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import {
    LayoutState,
    LayoutWrite,
    planCreateCategory,
    planCreateChannel,
    planDeleteCategory,
    planDeleteChannel,
    planMove,
    planRenameCategory,
    planUpdateChannel,
    ServerNotFoundError
} from '../../../domain'
import { SERVER_REPOSITORY, ServerRepositoryPort } from '../../ports'
import {
    CreateCategoryCommand,
    CreateChannelCommand,
    DeleteCategoryCommand,
    DeleteChannelCommand,
    MoveInLayoutCommand,
    RenameCategoryCommand,
    UpdateChannelCommand
} from './channel-layout.commands'

/**
 * What every change to the channel list does around its own rule: run it in
 * the locked transaction (ServerRepositoryPort.changeLayout), answer NOT_FOUND
 * when the server is gone or they are not in it, and, when channels changed,
 * tell the permission cache after the commit (D-146: it holds whether each
 * channel is private, its view roles and who may post). Categories and order
 * are not in the cache.
 */
abstract class ChangeLayout {
    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort
    ) {}

    protected async change(
        serverId: string,
        userId: string,
        decide: (state: LayoutState, now: Date) => LayoutWrite[],
        changesChannels: boolean
    ): Promise<{ createdId: string | null }> {
        const now = new Date()
        const result = await this.servers.changeLayout(serverId, userId, (state) => decide(state, now))
        if (!result) throw new ServerNotFoundError(serverId)
        if (changesChannels) await this.cache.serverChanged(serverId)
        return result
    }
}

@CommandHandler(CreateCategoryCommand)
export class CreateCategoryHandler extends ChangeLayout implements ICommandHandler<CreateCategoryCommand> {
    async execute({ userId, serverId, name }: CreateCategoryCommand): Promise<{ categoryId: string }> {
        const { createdId } = await this.change(serverId, userId, (s, now) => planCreateCategory(s, name, now), false)
        return { categoryId: createdId! }
    }
}

@CommandHandler(RenameCategoryCommand)
export class RenameCategoryHandler extends ChangeLayout implements ICommandHandler<RenameCategoryCommand> {
    async execute({ userId, serverId, categoryId, name }: RenameCategoryCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planRenameCategory(s, categoryId, name, now), false)
    }
}

@CommandHandler(DeleteCategoryCommand)
export class DeleteCategoryHandler extends ChangeLayout implements ICommandHandler<DeleteCategoryCommand> {
    async execute({ userId, serverId, categoryId }: DeleteCategoryCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planDeleteCategory(s, categoryId, now), false)
    }
}

@CommandHandler(CreateChannelCommand)
export class CreateChannelHandler extends ChangeLayout implements ICommandHandler<CreateChannelCommand> {
    async execute({ userId, serverId, draft }: CreateChannelCommand): Promise<{ channelId: string }> {
        const { createdId } = await this.change(serverId, userId, (s, now) => planCreateChannel(s, draft, now), true)
        return { channelId: createdId! }
    }
}

@CommandHandler(UpdateChannelCommand)
export class UpdateChannelHandler extends ChangeLayout implements ICommandHandler<UpdateChannelCommand> {
    async execute({ userId, serverId, channelId, edit }: UpdateChannelCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planUpdateChannel(s, channelId, edit, now), true)
    }
}

@CommandHandler(DeleteChannelCommand)
export class DeleteChannelHandler extends ChangeLayout implements ICommandHandler<DeleteChannelCommand> {
    async execute({ userId, serverId, channelId }: DeleteChannelCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planDeleteChannel(s, channelId, now), true)
    }
}

@CommandHandler(MoveInLayoutCommand)
export class MoveInLayoutHandler extends ChangeLayout implements ICommandHandler<MoveInLayoutCommand> {
    async execute({ userId, serverId, move }: MoveInLayoutCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planMove(s, move, now), false)
    }
}

export const CHANNEL_LAYOUT_HANDLERS = [
    CreateCategoryHandler,
    RenameCategoryHandler,
    DeleteCategoryHandler,
    CreateChannelHandler,
    UpdateChannelHandler,
    DeleteChannelHandler,
    MoveInLayoutHandler
]
