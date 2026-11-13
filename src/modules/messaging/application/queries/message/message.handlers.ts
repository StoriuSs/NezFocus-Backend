import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { MESSAGE_REPOSITORY, MessageRepositoryPort } from '../../../domain'
import { openChannel } from '../../services/channel-access'
import { MessageView, messageViews } from '../../services/message-views'
import { ListMessagesQuery } from './message.queries'

/** A page of history, oldest first, and whether there is more on each side. */
export interface MessagePageView {
    items: MessageView[]
    hasMoreBefore: boolean
    hasMoreAfter: boolean
}

/**
 * Whoever may view the channel reads all of its history (no separate right
 * to read older messages, D-47); a timed-out member included.
 */
@QueryHandler(ListMessagesQuery)
export class ListMessagesHandler implements IQueryHandler<ListMessagesQuery> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async execute({ userId, channelId, cursor, limit }: ListMessagesQuery): Promise<MessagePageView> {
        await openChannel(this.channels, this.permissions, channelId, userId, new Date())
        const page = await this.messages.page(channelId, cursor, limit)
        return { ...page, items: await messageViews(this.users, page.items) }
    }
}

export const MESSAGE_QUERY_HANDLERS = [ListMessagesHandler]
