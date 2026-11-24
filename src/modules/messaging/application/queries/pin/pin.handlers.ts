import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, ROLE_DIRECTORY, RoleDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { PIN_REPOSITORY, PinRepositoryPort, REACTION_REPOSITORY, ReactionRepositoryPort } from '../../../domain'
import { ATTACHMENT_STORAGE, AttachmentStoragePort, DM_ACCESS, DmAccessPort } from '../../ports'
import { openChannel } from '../../services/channel-access'
import { messageViews, ReadMessageView, withReactions } from '../../services/message-views'
import { ListPinsQuery } from './pin.queries'

/** A pinned message as the pins panel reads it. */
export interface PinnedMessageView extends ReadMessageView {
    pinnedAt: Date
}

/**
 * The pins panel (S-CHAT-02): the channel's pinned messages, the latest
 * pinned first, with their reactions as the reader sees them. Whoever may
 * view the channel reads them, as its history.
 */
@QueryHandler(ListPinsQuery)
export class ListPinsHandler implements IQueryHandler<ListPinsQuery> {
    constructor(
        @Inject(PIN_REPOSITORY) private readonly pins: PinRepositoryPort,
        @Inject(REACTION_REPOSITORY) private readonly reactions: ReactionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        @Inject(DM_ACCESS) private readonly dms: DmAccessPort
    ) {}

    async execute({ userId, channelId }: ListPinsQuery): Promise<PinnedMessageView[]> {
        const { serverId } = await openChannel(
            { channels: this.channels, checker: this.permissions, dms: this.dms },
            channelId,
            userId,
            new Date()
        )
        const pinned = await this.pins.list(channelId)
        const records = pinned.map((pin) => pin.message)
        const [views, summaries] = await Promise.all([
            messageViews({ users: this.users, roles: this.roles, files: this.files }, serverId, records),
            this.reactions.summaries(
                records.map((record) => record.id),
                userId
            )
        ])
        return withReactions(views, summaries).map((view, index) => ({ ...view, pinnedAt: pinned[index]!.pinnedAt }))
    }
}

export const PIN_QUERY_HANDLERS = [ListPinsHandler]
