import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, ServerChangedEvent } from '@/modules/servers'
import { channelOfRoom, VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { serversOf } from '../../services/room-access'
import { clearGoneRooms, recheckOccupant, RecheckSources } from '../../services/room-recheck'

/**
 * A server change that may change who can join its voice rooms or send in
 * them (D-210, D-212): every change of who may view what sets `viewChanged`
 * (a role's permissions, a role deleted, a channel made, deleted or made
 * private, the server deleted), and a new owner may rank differently. A
 * name, a colour or an order changes nothing here, and reads nothing.
 *
 * Everyone in the server's rooms is set right one by one (recheckOccupant):
 * put out and told why once they may no longer join (`permission`, or
 * `channel_deleted` for a deleted server), else sending what their
 * permissions allow now. A deleted channel took its rows with it, so the
 * rooms LiveKit has are read for the ones whose channel is gone.
 *
 * The roles of the people shown with them (D-205) need no new list here:
 * the members read the server again on this change (D-178), lists included.
 *
 * Not retried (adding-a-module.md › Events): the reconciliation puts out,
 * within a minute, anyone left in a room they may no longer be in.
 */
@EventsHandler(ServerChangedEvent)
export class RecheckServerRoomsHandler implements IEventHandler<ServerChangedEvent> {
    private readonly logger = new Logger(RecheckServerRoomsHandler.name)

    constructor(
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        private readonly events: EventBus
    ) {}

    async handle({ serverId, changes, viewChanged, ownerTransfer }: ServerChangedEvent): Promise<void> {
        if (!viewChanged && !ownerTransfer) return
        const sources: RecheckSources = {
            checker: this.checker,
            media: this.media,
            states: this.states,
            events: this.events,
            publisher: this.publisher
        }
        try {
            const occupants = await this.states.occupantsOf(await this.channels.channelIdsOf(serverId))
            // A deleted server's channels have no server here: their rooms are gone.
            const servers = await serversOf(
                this.channels,
                occupants.map((occupant) => occupant.channelId)
            )
            const now = new Date()
            for (const occupant of occupants) {
                try {
                    await recheckOccupant(sources, servers.get(occupant.channelId) ?? null, occupant, now)
                } catch (error) {
                    this.logger.warn(`Voice room of ${occupant.userId} not set right: ${(error as Error)?.message}`)
                }
            }
            if (changes.some((change) => change.topic === 'channel' && change.action === 'deleted')) {
                const rooms = (await this.media.listRooms()).map(channelOfRoom).filter((id) => id !== null)
                const live = await serversOf(this.channels, rooms)
                await clearGoneRooms(
                    sources,
                    rooms.filter((channelId) => !live.has(channelId))
                )
            }
        } catch (error) {
            this.logger.warn(`Voice rooms of server ${serverId} not set right: ${(error as Error)?.message}`)
        }
    }
}
