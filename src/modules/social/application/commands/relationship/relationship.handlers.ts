import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { keptNote, PersonNotFoundError, RelationshipWrite } from '../../../domain'
import { changeRelationship, RelationshipHandler } from '../../services/change-relationship'
import { findByUsername } from '../../services/find-by-username'
import {
    AcceptFriendRequestCommand,
    RemoveRelationshipCommand,
    RequestFriendByUsernameCommand,
    RequestFriendCommand
} from './relationship.commands'

/**
 * A request by username (REQ-SOCIAL-01, D-110): the name counted as a
 * lookup and read as the dialog writes it (findByUsername), a note kept
 * trimmed. Gives whom it named, for the answer's read.
 */
@CommandHandler(RequestFriendByUsernameCommand)
export class RequestFriendByUsernameHandler
    extends RelationshipHandler
    implements ICommandHandler<RequestFriendByUsernameCommand>
{
    async execute({ userId, username, note }: RequestFriendByUsernameCommand): Promise<{ otherId: string }> {
        const { users, limit } = this.sources
        const other = await findByUsername(users, limit, userId, username)
        if (!other) throw new PersonNotFoundError(username)
        await changeRelationship(this.sources, userId, other, {
            kind: 'request',
            from: 'username',
            note: keptNote(note)
        })
        return { otherId: other.id }
    }
}

/** A request from a profile (D-237): no note, and asking again changes nothing. */
@CommandHandler(RequestFriendCommand)
export class RequestFriendHandler extends RelationshipHandler implements ICommandHandler<RequestFriendCommand> {
    execute({ userId, otherId }: RequestFriendCommand): Promise<RelationshipWrite> {
        return changeRelationship(this.sources, userId, otherId, { kind: 'request', from: 'profile', note: null })
    }
}

@CommandHandler(AcceptFriendRequestCommand)
export class AcceptFriendRequestHandler
    extends RelationshipHandler
    implements ICommandHandler<AcceptFriendRequestCommand>
{
    execute({ userId, otherId }: AcceptFriendRequestCommand): Promise<RelationshipWrite> {
        return changeRelationship(this.sources, userId, otherId, { kind: 'accept' })
    }
}

@CommandHandler(RemoveRelationshipCommand)
export class RemoveRelationshipHandler
    extends RelationshipHandler
    implements ICommandHandler<RemoveRelationshipCommand>
{
    execute({ userId, otherId }: RemoveRelationshipCommand): Promise<RelationshipWrite> {
        return changeRelationship(this.sources, userId, otherId, { kind: 'remove' })
    }
}

export const RELATIONSHIP_COMMAND_HANDLERS = [
    RequestFriendByUsernameHandler,
    RequestFriendHandler,
    AcceptFriendRequestHandler,
    RemoveRelationshipHandler
]
