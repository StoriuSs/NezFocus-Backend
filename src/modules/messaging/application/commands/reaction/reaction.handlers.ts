import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import {
    decideReaction,
    MESSAGE_REPOSITORY,
    MessageRepositoryPort,
    MessageRuleError,
    normaliseEmoji,
    REACTION_REPOSITORY,
    ReactionRepositoryPort,
    TimedOutError
} from '../../../domain'
import { ReactionAddedEvent } from '../../events/reaction-added.event'
import { ReactionRemovedEvent } from '../../events/reaction-removed.event'
import { timedOutUntil } from '../../services/channel-access'
import { openMessage } from '../../services/message-access'
import { AddReactionCommand, RemoveReactionCommand } from './reaction.commands'

/**
 * Someone who sees the message gives it an emoji (REQ-MSG-05, SRS 1.71), kept
 * in its one standard form (`normaliseEmoji`): a timeout refuses before
 * anything else; an emoji already on the message may
 * be clicked by anyone, a new one needs ADD_REACTIONS and room under 20,
 * decided with the message locked (`decideReaction`). Only a reaction that
 * was not there tells the channel.
 */
@CommandHandler(AddReactionCommand)
export class AddReactionHandler implements ICommandHandler<AddReactionCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(REACTION_REPOSITORY) private readonly reactions: ReactionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, messageId, emoji: given }: AddReactionCommand): Promise<void> {
        const now = new Date()
        const { message, channel } = await openMessage(
            this.messages,
            this.channels,
            this.permissions,
            messageId,
            userId,
            now
        )
        const until = timedOutUntil(channel, now)
        if (until) throw new TimedOutError(until)
        const emoji = normaliseEmoji(given)
        if (!emoji) throw new MessageRuleError('emoji')

        const mayAddNew = (channel.permissions & Permission.ADD_REACTIONS) !== 0n
        const decision = await this.reactions.add(messageId, emoji, userId, (facts) =>
            decideReaction(facts, { mayAddNew })
        )
        if (decision === 'add') this.events.publish(new ReactionAddedEvent(message.channelId, messageId, emoji, userId))
    }
}

/**
 * Someone takes their emoji off a message they see (REQ-MSG-05); while timed
 * out they cannot (SRS 1.71). One they had not given changes nothing and
 * tells no one.
 */
@CommandHandler(RemoveReactionCommand)
export class RemoveReactionHandler implements ICommandHandler<RemoveReactionCommand> {
    constructor(
        @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
        @Inject(REACTION_REPOSITORY) private readonly reactions: ReactionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        private readonly events: EventBus
    ) {}

    async execute({ userId, messageId, emoji: given }: RemoveReactionCommand): Promise<void> {
        const now = new Date()
        const { message, channel } = await openMessage(
            this.messages,
            this.channels,
            this.permissions,
            messageId,
            userId,
            now
        )
        const until = timedOutUntil(channel, now)
        if (until) throw new TimedOutError(until)
        // Not one emoji: none of that was given, so nothing to take off.
        const emoji = normaliseEmoji(given)
        if (!emoji) return

        if (await this.reactions.remove(messageId, emoji, userId))
            this.events.publish(new ReactionRemovedEvent(message.channelId, messageId, emoji, userId))
    }
}

export const REACTION_COMMAND_HANDLERS = [AddReactionHandler, RemoveReactionHandler]
