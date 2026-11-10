import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import {
    planCreateRole,
    planDeleteRole,
    planGrantRole,
    planReorderRoles,
    planRevokeRole,
    planUpdateRole
} from '../../../domain'
import { ChangeRoles } from '../../services/change-roles'
import {
    CreateRoleCommand,
    DeleteRoleCommand,
    GrantRoleCommand,
    ReorderRolesCommand,
    RevokeRoleCommand,
    UpdateRoleCommand
} from './role.commands'

@CommandHandler(CreateRoleCommand)
export class CreateRoleHandler extends ChangeRoles implements ICommandHandler<CreateRoleCommand> {
    async execute({ userId, serverId, name }: CreateRoleCommand): Promise<{ roleId: string }> {
        const { createdId } = await this.change(serverId, userId, [], (s, now) => planCreateRole(s, name, now))
        return { roleId: createdId! }
    }
}

@CommandHandler(UpdateRoleCommand)
export class UpdateRoleHandler extends ChangeRoles implements ICommandHandler<UpdateRoleCommand> {
    async execute({ userId, serverId, roleId, edit }: UpdateRoleCommand): Promise<void> {
        await this.change(serverId, userId, [], (s, now) => planUpdateRole(s, roleId, edit, now))
    }
}

@CommandHandler(DeleteRoleCommand)
export class DeleteRoleHandler extends ChangeRoles implements ICommandHandler<DeleteRoleCommand> {
    async execute({ userId, serverId, roleId }: DeleteRoleCommand): Promise<void> {
        await this.change(serverId, userId, [], (s, now) => planDeleteRole(s, roleId, now))
    }
}

@CommandHandler(ReorderRolesCommand)
export class ReorderRolesHandler extends ChangeRoles implements ICommandHandler<ReorderRolesCommand> {
    async execute({ userId, serverId, seen, wanted }: ReorderRolesCommand): Promise<void> {
        await this.change(serverId, userId, [], (s, now) => planReorderRoles(s, seen, wanted, now))
    }
}

@CommandHandler(GrantRoleCommand)
export class GrantRoleHandler extends ChangeRoles implements ICommandHandler<GrantRoleCommand> {
    async execute({ userId, serverId, roleId, userIds }: GrantRoleCommand): Promise<void> {
        await this.change(serverId, userId, userIds, (s, now) => planGrantRole(s, roleId, userIds, now))
    }
}

@CommandHandler(RevokeRoleCommand)
export class RevokeRoleHandler extends ChangeRoles implements ICommandHandler<RevokeRoleCommand> {
    async execute({ userId, serverId, roleId, targetId }: RevokeRoleCommand): Promise<void> {
        await this.change(serverId, userId, [targetId], (s, now) => planRevokeRole(s, roleId, targetId, now))
    }
}

export const ROLE_COMMAND_HANDLERS = [
    CreateRoleHandler,
    UpdateRoleHandler,
    DeleteRoleHandler,
    ReorderRolesHandler,
    GrantRoleHandler,
    RevokeRoleHandler
]
