import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { RelationshipWrite } from '../../../domain'
import { changeRelationship, RelationshipHandler } from '../../services/change-relationship'
import { BlockUserCommand, UnblockUserCommand } from './block.commands'

@CommandHandler(BlockUserCommand)
export class BlockUserHandler extends RelationshipHandler implements ICommandHandler<BlockUserCommand> {
    execute({ userId, otherId }: BlockUserCommand): Promise<RelationshipWrite> {
        return changeRelationship(this.sources, userId, otherId, { kind: 'block' })
    }
}

@CommandHandler(UnblockUserCommand)
export class UnblockUserHandler extends RelationshipHandler implements ICommandHandler<UnblockUserCommand> {
    execute({ userId, otherId }: UnblockUserCommand): Promise<RelationshipWrite> {
        return changeRelationship(this.sources, userId, otherId, { kind: 'unblock' })
    }
}

export const BLOCK_COMMAND_HANDLERS = [BlockUserHandler, UnblockUserHandler]
