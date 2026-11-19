import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, MemberChangedEvent } from '@/modules/servers'
import { reasonForLeaving, VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { putOut } from '../../services/leave-room'
import { recheckOccupant, RecheckSources } from '../../services/room-recheck'
import { VoiceStateChangedEvent } from '../voice-state-changed.event'

/**
 * A member who left a server, or changed in it, while in one of its voice
 * rooms (ROADMAP M2 "the same for voice rooms", D-210, D-212): kicked,
 * banned or gone by themselves, they are put out and told why; timed out,
 * or without CONNECT, the same; else LiveKit is told what they may send now
 * (SPEAK, VIDEO), and the room their roles again (D-205), for the
 * moderators' menus. The permission cache knows of the change by now
 * (servers tells it before the event, D-146).
 *
 * Not retried (adding-a-module.md › Events): LiveKit unreachable leaves them
 * in until the reconciliation, within a minute, puts out anyone left in a
 * room they may no longer be in.
 */
@EventsHandler(MemberChangedEvent)
export class RecheckMemberRoomHandler implements IEventHandler<MemberChangedEvent> {
    private readonly logger = new Logger(RecheckMemberRoomHandler.name)

    constructor(
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        private readonly events: EventBus
    ) {}

    async handle({ serverId, userId, action, removedBy }: MemberChangedEvent): Promise<void> {
        if (action === 'joined') return
        const state = await this.states.find(userId)
        if (!state || (await this.channels.serverIdOf(state.channelId)) !== serverId) return
        const sources: RecheckSources = {
            checker: this.checker,
            media: this.media,
            states: this.states,
            events: this.events,
            publisher: this.publisher
        }
        try {
            if (action === 'left') {
                await putOut(sources, state, reasonForLeaving(removedBy))
            } else if (await recheckOccupant(sources, serverId, state, new Date())) {
                this.events.publish(new VoiceStateChangedEvent(state.channelId, userId, 'updated', state.joinedAt))
            }
        } catch (error) {
            this.logger.warn(
                `Voice room of ${userId} not set right in server ${serverId}: ${(error as Error)?.message}`
            )
        }
    }
}
