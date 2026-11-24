import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, ROLE_DIRECTORY, RoleDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CannotPinError,
    decidePin,
    MESSAGE_REPOSITORY,
    MessageNotFoundError,
    MessageRepositoryPort,
    PIN_REPOSITORY,
    PinRepositoryPort,
    requirePinsIn,
    TimedOutError
} from '../../../domain'
import { ATTACHMENT_STORAGE, AttachmentStoragePort, DM_ACCESS, DmAccessPort } from '../../ports'
import { MessageCreatedEvent } from '../../events/message-created.event'
import { PinsUpdatedEvent } from '../../events/pins-updated.event'
import { ChannelSources, requireMessaging, timedOutUntil } from '../../services/channel-access'
import { openMessage } from '../../services/message-access'
import { messageViews } from '../../services/message-views'
import { PinMessageCommand, UnpinMessageCommand } from './pin.commands'

/**
 * Let through only someone who may pin or unpin this message in `channelId`
 * (REQ-MSG-07): a message of that channel they see (else not found, naming
 * nothing), while not timed out (said first, as for deleting), with
 * MANAGE_MESSAGES, and not in a voice room's chat, which has no pins
 * (D-213). In a DM both pin, while they may still message the other one
 * (D-238, D-242: a pin writes a system message the other one reads). Gives
 * the channel's server, null for a DM.
 */
async function requirePinning(
    messages: MessageRepositoryPort,
    access: ChannelSources,
    { userId, channelId, messageId }: PinMessageCommand | UnpinMessageCommand
): Promise<string | null> {
    const now = new Date()
    const { message, channel } = await openMessage(messages, access, messageId, userId, now, 'write')
    if (message.channelId !== channelId) throw new MessageNotFoundError(messageId)
    const until = timedOutUntil(channel, now)
    if (until) throw new TimedOutError(until)
    if (channel.type === 'dm') requireMessaging(channel)
    else if ((channel.permissions & Permission.MANAGE_MESSAGES) === 0n) throw new CannotPinError()
    requirePinsIn(channel.type)
    return channel.serverId
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
        @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectoryPort,
        @Inject(ATTACHMENT_STORAGE) private readonly files: AttachmentStoragePort,
        private readonly events: EventBus,
        @Inject(DM_ACCESS) private readonly dms: DmAccessPort
    ) {}

    /** Where opening a channel reads (services/channel-access.ts). */
    private get access(): ChannelSources {
        return { channels: this.channels, checker: this.permissions, dms: this.dms }
    }

    async execute(command: PinMessageCommand): Promise<void> {
        const serverId = await requirePinning(this.messages, this.access, command)
        const { userId, channelId, messageId } = command

        const { decision, notice } = await this.pins.pin(channelId, messageId, userId, decidePin)
        if (decision === 'already') return
        this.events.publish(new PinsUpdatedEvent(channelId, messageId, true))
        if (notice) {
            const [view] = await messageViews({ users: this.users, roles: this.roles, files: this.files }, serverId, [
                notice
            ])
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
        private readonly events: EventBus,
        @Inject(DM_ACCESS) private readonly dms: DmAccessPort
    ) {}

    /** Where opening a channel reads (services/channel-access.ts). */
    private get access(): ChannelSources {
        return { channels: this.channels, checker: this.permissions, dms: this.dms }
    }

    async execute(command: UnpinMessageCommand): Promise<void> {
        await requirePinning(this.messages, this.access, command)
        const { channelId, messageId } = command

        if (await this.pins.unpin(channelId, messageId))
            this.events.publish(new PinsUpdatedEvent(channelId, messageId, false))
    }
}

export const PIN_COMMAND_HANDLERS = [PinMessageHandler, UnpinMessageHandler]
