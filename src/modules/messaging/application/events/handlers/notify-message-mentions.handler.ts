import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import {
    MESSAGE_REPOSITORY,
    MessageRepositoryPort,
    READ_STATE_REPOSITORY,
    ReadStateRepositoryPort
} from '../../../domain'
import { mentionSourcesOf, peopleOf } from '../../services/mention-sources'
import { MessageCreatedEvent } from '../message-created.event'
import { MessageUpdatedEvent } from '../message-updated.event'

/**
 * A message sent or edited puts an item in the inbox of each person it is
 * about (REQ-NOTIF-01, D-183, D-188), through NOTIFIER (D-185), after the
 * message is saved: a failure here never fails the send (it is logged).
 * System messages have no author and make none, and a DM makes none
 * (D-238: its two people read it whole; the 💬 badge counts it): a channel
 * with no server is one, or is gone.
 *
 * Those who had read the channel past the message get theirs read (D-199):
 * read before NOTIFIER writes, and again after, for an ack that landed in
 * between and found no item to mark. On an edit, someone who joined after
 * the message was sent reads from where they joined (D-170): past it.
 */
@EventsHandler(MessageCreatedEvent, MessageUpdatedEvent)
export class NotifyMessageMentionsHandler implements IEventHandler<MessageCreatedEvent | MessageUpdatedEvent> {
    private readonly logger = new Logger(NotifyMessageMentionsHandler.name)

    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(READ_STATE_REPOSITORY) private readonly readStates: ReadStateRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(NOTIFIER) private readonly notifier: NotifierPort
    ) {}

    async handle(event: MessageCreatedEvent | MessageUpdatedEvent): Promise<void> {
        const { message } = event
        if (!message.author) return
        try {
            // No server: a DM, which puts nothing in an inbox (D-238), or a channel gone since.
            const serverId = await this.channels.serverIdOf(message.channelId)
            if (!serverId) return
            const sources = await mentionSourcesOf(
                { messages: this.messages, membership: this.membership, checker: this.checker },
                serverId,
                message
            )
            const people = peopleOf(sources)
            if (people.length === 0 && event instanceof MessageCreatedEvent) return
            const readers = new Set(await this.readStates.readersPast(message.channelId, people, message.id))
            if (event instanceof MessageUpdatedEvent && people.length > 0) {
                const members = await this.membership.channelMembers(serverId, { viewers: null, userIds: people })
                for (const { userId, joinedAt } of members) {
                    if (joinedAt > message.createdAt) readers.add(userId)
                }
            }
            await this.notifier.messageMentions({
                serverId,
                channelId: message.channelId,
                messageId: message.id,
                actorId: message.author.id,
                sentAt: message.createdAt,
                sources,
                readerIds: [...readers]
            })
            const late = (await this.readStates.readersPast(message.channelId, people, message.id)).filter(
                (userId) => !readers.has(userId)
            )
            for (const userId of late) await this.notifier.channelRead(userId, message.channelId, message.id)
        } catch (error) {
            this.logger.error(`Could not write the inbox items of message ${message.id}`, error)
        }
    }
}
