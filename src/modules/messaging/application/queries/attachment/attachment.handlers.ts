import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import {
    ATTACHMENT_REPOSITORY,
    AttachmentNotFoundError,
    AttachmentRepositoryPort,
    ChannelNotFoundError
} from '../../../domain'
import { ATTACHMENT_STORAGE, AttachmentStoragePort } from '../../ports'
import { attachmentView, AttachmentView } from '../../services/attachment-views'
import { openChannel } from '../../services/channel-access'
import { GetAttachmentLinksQuery } from './attachment.queries'

/**
 * A file of a message in a channel the person may view, or a checked one of
 * their own not sent yet (the tray). Anything else, a deleted message's file
 * included, is not found, naming nothing (NFR-SEC-05).
 */
@QueryHandler(GetAttachmentLinksQuery)
export class GetAttachmentLinksHandler implements IQueryHandler<GetAttachmentLinksQuery> {
    constructor(
        @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepositoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort
    ) {}

    async execute({ userId, attachmentId }: GetAttachmentLinksQuery): Promise<AttachmentView> {
        const file = await this.attachments.find(attachmentId)
        const notFound = new AttachmentNotFoundError([attachmentId])
        if (!file?.completedAt || !file.contentType) throw notFound
        if (file.channelId) {
            try {
                await openChannel(this.channels, this.permissions, file.channelId, userId, new Date())
            } catch (error) {
                throw error instanceof ChannelNotFoundError ? notFound : error
            }
        } else if (file.uploaderId !== userId || file.position !== null) {
            throw notFound
        }
        return attachmentView(this.storage, { ...file, contentType: file.contentType })
    }
}

export const ATTACHMENT_QUERY_HANDLERS = [GetAttachmentLinksHandler]
