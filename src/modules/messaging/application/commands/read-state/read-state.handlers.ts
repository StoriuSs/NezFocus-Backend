import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, MEMBERSHIP, MembershipPort } from '@/modules/servers'
import {
    ChannelNotFoundError,
    MESSAGE_REPOSITORY,
    MessageNotFoundError,
    MessageRepositoryPort,
    READ_STATE_REPOSITORY,
    ReadStateRepositoryPort
} from '../../../domain'
import { ReadStateUpdatedEvent } from '../../events/read-state-updated.event'
import { openChannel } from '../../services/channel-access'
import { joinedAt, ReadStateView, readStatesIn } from '../../services/read-states'
import { AckChannelCommand } from './read-state.commands'

/**
 * Marks a text channel the person may view read up to a message of it
 * (REQ-MSG-09), deleted or not (it stays a place in the channel); a message
 * of another channel is not found, as a far place would mark later messages
 * read. The mark only moves forward (D-173): two tabs acking out of order
 * never take it back. The person's tabs and devices are told
 * (`read_state.updated`); the answer is the same state.
 */
@CommandHandler(AckChannelCommand)
export class AckChannelHandler implements ICommandHandler<AckChannelCommand> {
    constructor(
        @Inject(READ_STATE_REPOSITORY) private readonly readStates: ReadStateRepositoryPort,
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, channelId, messageId }: AckChannelCommand): Promise<ReadStateView> {
        const channel = await openChannel(this.channels, this.permissions, channelId, userId, new Date())
        let target: string | null
        if (messageId) {
            const message = await this.messages.find(messageId)
            if (message?.channelId !== channelId) throw new MessageNotFoundError(messageId)
            target = message.id
        } else {
            target = await this.messages.latestId(channelId)
        }
        const joined = await joinedAt(this.membership, userId, channel.serverId)
        // Left the server since the permission check.
        if (!joined) throw new ChannelNotFoundError(channelId)

        if (target) await this.readStates.markRead(userId, channelId, target)
        const [state] = await readStatesIn(this.readStates, channel.serverId, channel.member, joined, [channelId])
        if (target) this.events.publish(new ReadStateUpdatedEvent(userId, state))
        return state
    }
}

export const READ_STATE_COMMAND_HANDLERS = [AckChannelHandler]
