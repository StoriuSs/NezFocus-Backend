import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, ROLE_DIRECTORY, RoleDirectoryPort } from '@/modules/servers'
import { MessagePreview } from '@/modules/notifications'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { MESSAGE_REPOSITORY, MessageRepositoryPort, REACTION_REPOSITORY, ReactionRepositoryPort } from '../../../domain'
import { ATTACHMENT_STORAGE, AttachmentStoragePort, DM_ACCESS, DmAccessPort } from '../../ports'
import { openChannel } from '../../services/channel-access'
import { messageViews, ReadMessageView, withReactions } from '../../services/message-views'
import { ListMessagePreviewsQuery, ListMessagesQuery } from './message.queries'

/** A page of history, oldest first, and whether there is more on each side. */
export interface MessagePageView {
    items: ReadMessageView[]
    hasMoreBefore: boolean
    hasMoreAfter: boolean
}

/**
 * Whoever may view the channel reads all of its history (no separate right
 * to read older messages, D-47); a timed-out member included; the two of a
 * DM, even once they may no longer message each other (D-238). Each message
 * comes with its reactions as the reader sees them (REQ-MSG-05).
 */
@QueryHandler(ListMessagesQuery)
export class ListMessagesHandler implements IQueryHandler<ListMessagesQuery> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(REACTION_REPOSITORY) private readonly reactions: ReactionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        @Inject(DM_ACCESS) private readonly dms: DmAccessPort
    ) {}

    async execute({ userId, channelId, cursor, limit }: ListMessagesQuery): Promise<MessagePageView> {
        const { serverId } = await openChannel(
            { channels: this.channels, checker: this.permissions, dms: this.dms },
            channelId,
            userId,
            new Date()
        )
        const page = await this.messages.page(channelId, cursor, limit)
        const [views, summaries] = await Promise.all([
            messageViews({ users: this.users, roles: this.roles, files: this.files }, serverId, page.items),
            this.reactions.summaries(
                page.items.map((item) => item.id),
                userId
            )
        ])
        return { ...page, items: withReactions(views, summaries) }
    }
}

/**
 * Messages as inbox items show them (D-184): the text as written, the names
 * of those it mentions and of its roles now (D-171; a role deleted since is
 * left out), how many files and images. A deleted message is left out: its
 * item is on its way out (REQ-NOTIF-03). One read for the messages, one per
 * server for role names.
 */
@QueryHandler(ListMessagePreviewsQuery)
export class ListMessagePreviewsHandler implements IQueryHandler<ListMessagePreviewsQuery> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort
    ) {}

    async execute({ messages }: ListMessagePreviewsQuery): Promise<MessagePreview[]> {
        const records = await this.messages.findLive(messages.map((message) => message.id))
        const serverOf = new Map(messages.map((message) => [message.id, message.serverId]))
        const asked = new Map<string, Set<string>>()
        for (const record of records) {
            const serverId = serverOf.get(record.id)!
            const roleIds = asked.get(serverId) ?? new Set<string>()
            record.mentionRoleIds.forEach((id) => roleIds.add(id))
            asked.set(serverId, roleIds)
        }
        const names = new Map<string, string>()
        await Promise.all(
            [...asked]
                .filter(([, roleIds]) => roleIds.size > 0)
                .map(async ([serverId, roleIds]) => {
                    for (const role of await this.roles.rolesOf(serverId, [...roleIds])) names.set(role.id, role.name)
                })
        )
        return records.map((record) => ({
            id: record.id,
            content: record.content,
            mentionUsers: record.mentionUsers.map(({ id, username, displayName }) => ({ id, username, displayName })),
            mentionRoles: record.mentionRoleIds.flatMap((id) => {
                const name = names.get(id)
                return name === undefined ? [] : [{ id, name }]
            }),
            // An image is the one kind of file with a size.
            files: {
                count: record.attachments.length,
                images: record.attachments.filter((file) => file.width !== null).length
            }
        }))
    }
}

export const MESSAGE_QUERY_HANDLERS = [ListMessagesHandler, ListMessagePreviewsHandler]
