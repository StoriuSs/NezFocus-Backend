import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import {
    planCreateCategory,
    planCreateChannel,
    planDeleteCategory,
    planDeleteChannel,
    planMove,
    planRenameCategory,
    planUpdateChannel
} from '../../../domain'
import { ChangeLayout } from '../../services/change-layout'
import {
    CreateCategoryCommand,
    CreateChannelCommand,
    DeleteCategoryCommand,
    DeleteChannelCommand,
    MoveInLayoutCommand,
    RenameCategoryCommand,
    UpdateChannelCommand
} from './channel-layout.commands'

@CommandHandler(CreateCategoryCommand)
export class CreateCategoryHandler extends ChangeLayout implements ICommandHandler<CreateCategoryCommand> {
    async execute({ userId, serverId, name }: CreateCategoryCommand): Promise<{ categoryId: string }> {
        const { createdId } = await this.change(serverId, userId, (s, now) => planCreateCategory(s, name, now))
        return { categoryId: createdId! }
    }
}

@CommandHandler(RenameCategoryCommand)
export class RenameCategoryHandler extends ChangeLayout implements ICommandHandler<RenameCategoryCommand> {
    async execute({ userId, serverId, categoryId, name }: RenameCategoryCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planRenameCategory(s, categoryId, name, now))
    }
}

@CommandHandler(DeleteCategoryCommand)
export class DeleteCategoryHandler extends ChangeLayout implements ICommandHandler<DeleteCategoryCommand> {
    async execute({ userId, serverId, categoryId }: DeleteCategoryCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planDeleteCategory(s, categoryId, now))
    }
}

@CommandHandler(CreateChannelCommand)
export class CreateChannelHandler extends ChangeLayout implements ICommandHandler<CreateChannelCommand> {
    async execute({ userId, serverId, draft }: CreateChannelCommand): Promise<{ channelId: string }> {
        const { createdId } = await this.change(serverId, userId, (s, now) => planCreateChannel(s, draft, now))
        return { channelId: createdId! }
    }
}

@CommandHandler(UpdateChannelCommand)
export class UpdateChannelHandler extends ChangeLayout implements ICommandHandler<UpdateChannelCommand> {
    async execute({ userId, serverId, channelId, edit }: UpdateChannelCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planUpdateChannel(s, channelId, edit, now))
    }
}

@CommandHandler(DeleteChannelCommand)
export class DeleteChannelHandler extends ChangeLayout implements ICommandHandler<DeleteChannelCommand> {
    async execute({ userId, serverId, channelId }: DeleteChannelCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planDeleteChannel(s, channelId, now))
    }
}

@CommandHandler(MoveInLayoutCommand)
export class MoveInLayoutHandler extends ChangeLayout implements ICommandHandler<MoveInLayoutCommand> {
    async execute({ userId, serverId, move }: MoveInLayoutCommand): Promise<void> {
        await this.change(serverId, userId, (s, now) => planMove(s, move, now))
    }
}

export const CHANNEL_LAYOUT_COMMAND_HANDLERS = [
    CreateCategoryHandler,
    RenameCategoryHandler,
    DeleteCategoryHandler,
    CreateChannelHandler,
    UpdateChannelHandler,
    DeleteChannelHandler,
    MoveInLayoutHandler
]
