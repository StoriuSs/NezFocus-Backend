import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { serversOf } from '../../services/room-access'
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
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async handle({ channelId }: VoiceStateChangedEvent): Promise<void> {
        // Read before the room's lock: a list told under it reads nothing more
        // from the database (the roles come from the permission cache).
        const servers = await serversOf(this.channels, [channelId])
        await this.states.tellOccupants(channelId, async (occupants) => {
            const people = await peopleOf({ users: this.users, checker: this.checker }, servers, [channelId], occupants)
            this.publisher.toChannel(channelId, 'voice_state.updated', {
                channelId,
                voiceStates: people.get(channelId) ?? []
            })
        })
    }
}
