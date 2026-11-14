import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CannotPinError,
    decidePin,
    MESSAGE_REPOSITORY,
    MessageNotFoundError,
    MessageRepositoryPort,
    PIN_REPOSITORY,
    PinRepositoryPort,
    TimedOutError
} from '../../../domain'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { PinsUpdatedEvent } from '../../events/pins-updated.event'
import { timedOutUntil } from '../../services/channel-access'
import { openMessage } from '../../services/message-access'
import { messageViews } from '../../services/message-views'
import { PinMessageCommand, UnpinMessageCommand } from './pin.commands'

/**
 * Let through only someone who may pin or unpin this message in `channelId`
 * (REQ-MSG-07): a message of that channel they see (else not found, naming
 * nothing), while not timed out (said first, as for deleting), with
 * MANAGE_MESSAGES.
 */
async function requirePinning(
    messages: MessageRepositoryPort,
    channels: ChannelDirectoryPort,
    permissions: PermissionCheckerPort,
    { userId, channelId, messageId }: PinMessageCommand | UnpinMessageCommand
): Promise<void> {
    const now = new Date()
    const { message, channel } = await openMessage(messages, channels, permissions, messageId, userId, now)
    if (message.channelId !== channelId) throw new MessageNotFoundError(messageId)
    const until = timedOutUntil(channel, now)
    if (until) throw new TimedOutError(until)
    if ((channel.permissions & Permission.MANAGE_MESSAGES) === 0n) throw new CannotPinError()
}

/**
 * A moderator pins a regular message (REQ-MSG-07, SRS 1.71). The pin and the
 * system message "<who> pinned a message" (REQ-MSG-08) are saved together,
 * under a lock of the channel's pins that keeps them at 50; the channel hears
 * both. A message pinned already changes nothing and tells no one.
 */
@CommandHandler(PinMessageCommand)
export class PinMessageHandler implements ICommandHandler<PinMessageCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(PIN_REPOSITORY) private readonly pins: PinRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        private readonly events: EventBus
    ) {}

    async execute(command: PinMessageCommand): Promise<void> {
        await requirePinning(this.messages, this.channels, this.permissions, command)
        const { userId, channelId, messageId } = command

        const { decision, notice } = await this.pins.pin(channelId, messageId, userId, decidePin)
        if (decision === 'already') return
        this.events.publish(new PinsUpdatedEvent(channelId, messageId, true))
        if (notice) {
            const [view] = await messageViews(this.users, [notice])
            this.events.publish(new MessageCreatedEvent(view, null))
        }
    }
}

/** A moderator unpins a message (REQ-MSG-07): no system message (SRS 1.71); one not pinned tells no one. */
@CommandHandler(UnpinMessageCommand)
export class UnpinMessageHandler implements ICommandHandler<UnpinMessageCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(PIN_REPOSITORY) private readonly pins: PinRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        private readonly events: EventBus
    ) {}

    async execute(command: UnpinMessageCommand): Promise<void> {
        await requirePinning(this.messages, this.channels, this.permissions, command)
        const { channelId, messageId } = command

        if (await this.pins.unpin(channelId, messageId))
            this.events.publish(new PinsUpdatedEvent(channelId, messageId, false))
    }
}

export const PIN_COMMAND_HANDLERS = [PinMessageHandler, UnpinMessageHandler]
