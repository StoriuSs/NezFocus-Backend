import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import {
    MESSAGE_REPOSITORY,
    MessageAuthor,
    MessageRepositoryPort,
    normaliseEmoji,
    REACTION_REPOSITORY,
    REACTORS_SHOWN,
    ReactionRepositoryPort
} from '../../../domain'
import { openMessage } from '../../services/message-access'
import { ListReactorsQuery } from './reaction.queries'

/** Someone named in a reaction's tooltip: the name only, no picture. */
export type ReactorView = Pick<MessageAuthor, 'id' | 'username' | 'displayName'>

/** The first people to give an emoji, and how many gave it in all. */
export interface ReactorsView {
    users: ReactorView[]
    count: number
}

/**
 * The tooltip of a reaction (C-10 ReactionChip, SRS 1.71): "Bình, Chi, Dũng
 * and 5 others reacted with 👍". Anyone who sees the message may read it, a
 * timed-out member included.
 */
@QueryHandler(ListReactorsQuery)
export class ListReactorsHandler implements IQueryHandler<ListReactorsQuery> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(REACTION_REPOSITORY) private readonly reactions: ReactionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort
    ) {}

    async execute({ userId, messageId, emoji }: ListReactorsQuery): Promise<ReactorsView> {
        await openMessage(this.messages, this.channels, this.permissions, messageId, userId, new Date())
        const standard = normaliseEmoji(emoji)
        if (!standard) return { users: [], count: 0 }
        const { users, count } = await this.reactions.reactors(messageId, standard, REACTORS_SHOWN)
        return { users: users.map(({ id, username, displayName }) => ({ id, username, displayName })), count }
    }
}

export const REACTION_QUERY_HANDLERS = [ListReactorsHandler]
