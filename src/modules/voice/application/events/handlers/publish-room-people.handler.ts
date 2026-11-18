import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { peopleOf } from '../../services/room-people'
import { VoiceStateChangedEvent } from '../voice-state-changed.event'

/**
 * `voice_state.updated { channel_id, voice_states }` to the room's channel
 * (D-205): only sockets that may view the room are in it, so a private
 * room's people are seen by its viewers alone. The whole list, read after
 * the commit, so the client only replaces its copy; read and told under the
 * room's lock, so a list read earlier is never told after a newer one.
 */
@EventsHandler(VoiceStateChangedEvent)
export class PublishRoomPeopleHandler implements IEventHandler<VoiceStateChangedEvent> {
    constructor(
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort
    ) {}

    async handle({ channelId }: VoiceStateChangedEvent): Promise<void> {
        await this.states.tellOccupants(channelId, async (occupants) => {
            const people = await peopleOf(this.users, [channelId], occupants)
            this.publisher.toChannel(channelId, 'voice_state.updated', {
                channelId,
                voiceStates: people.get(channelId) ?? []
            })
        })
    }
}
