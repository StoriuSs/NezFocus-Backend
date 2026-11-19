import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import {
    channelOfRoom,
    joinWrite,
    leaveWrite,
    VOICE_STATE_REPOSITORY,
    VoiceConnection,
    VoiceStateRepositoryPort,
    voiceRoomOf
} from '../../../domain'
import {
    EVENT_RECEIPTS,
    EventReceiptsPort,
    MEDIA_EVENTS,
    MEDIA_ROOMS,
    MediaEventsPort,
    MediaRoomsPort
} from '../../ports'
import { standingOf } from '../../services/room-recheck'
import { changeEvents } from '../../services/voice-changes'
import { ApplyMediaEventCommand } from './media-event.commands'

/**
 * Who came into a voice room and who went out, as LiveKit tells it (D-210):
 * the truth about who is in a room. A webhook not signed by LiveKit is
 * refused (401) before anything is read from it. One about any other room
 * (calls are M6's) or of another kind is answered and left alone.
 *
 * Taken once per event id: the same event sent again changes nothing. Out
 * of order is the rules' work: a late participant_joined of an older
 * connection, or the participant_left of the connection a reload replaced,
 * is ignored. When writing fails the id is forgotten, so the event sent
 * again (LiveKit retries an error answer) is taken. A join taken twice
 * around its leave (Redis down, or that retry coming after the leave) puts
 * back someone gone, until the reconciliation removes them.
 *
 * Someone who joined a room while still connected to another (two tabs, two
 * rooms) is put out of the other: one connection per account (D-210). The
 * participant_left that follows changes nothing.
 *
 * Someone who joined a room they may no longer be in (a token taken before
 * a ban or a timeout, used within its ten minutes; the room deleted) is put
 * out at once, told why, and never listed (D-212).
 */
@CommandHandler(ApplyMediaEventCommand)
export class ApplyMediaEventHandler implements ICommandHandler<ApplyMediaEventCommand> {
    constructor(
        @Inject(MEDIA_EVENTS) private readonly mediaEvents: MediaEventsPort,
        @Inject(EVENT_RECEIPTS) private readonly receipts: EventReceiptsPort,
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        private readonly events: EventBus
    ) {}

    async execute({ body, authorization }: ApplyMediaEventCommand): Promise<void> {
        const event = await this.mediaEvents.read(body, authorization)
        if (event.kind === 'other') return
        const channelId = channelOfRoom(event.room)
        if (!channelId) return
        if (!(await this.receipts.firstSight(event.id))) return

        const connection: VoiceConnection = {
            userId: event.identity,
            channelId,
            participantSid: event.participantSid,
            joinedAt: event.joinedAt
        }
        let result: Awaited<ReturnType<VoiceStateRepositoryPort['change']>>
        try {
            if (event.kind === 'joined' && !(await this.mayStay(event.room, channelId, event.identity))) return
            result = await this.states.change(event.identity, (current) =>
                event.kind === 'joined' ? joinWrite(current, connection) : leaveWrite(current, event.participantSid)
            )
        } catch (error) {
            await this.receipts.forget(event.id)
            throw error
        }
        for (const changed of changeEvents(result)) this.events.publish(changed)

        const before = result?.after ? result.before : null
        if (before && before.channelId !== channelId) {
            // Not reached now: the reconciliation puts them out within minutes (the adapter logged why).
            await this.media.removeParticipant(voiceRoomOf(before.channelId), event.identity).catch(() => undefined)
        }
    }

    /**
     * Whether the person who joined `room` may be there; if not, they are
     * put out and told why. LiveKit unreachable throws: the event is sent
     * again.
     */
    private async mayStay(room: string, channelId: string, userId: string): Promise<boolean> {
        const serverId = await this.channels.serverIdOf(channelId)
        const standing = await standingOf(this.checker, serverId, channelId, userId, new Date())
        if (standing.kind === 'in') return true
        if (await this.media.removeParticipant(room, userId)) {
            this.publisher.toUser(userId, 'voice.disconnected', { channelId, reason: standing.reason })
        }
        return false
    }
}

export const MEDIA_EVENT_COMMAND_HANDLERS = [ApplyMediaEventHandler]
