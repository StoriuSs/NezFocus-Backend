import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
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
 */
@CommandHandler(ApplyMediaEventCommand)
export class ApplyMediaEventHandler implements ICommandHandler<ApplyMediaEventCommand> {
    constructor(
        @Inject(MEDIA_EVENTS) private readonly mediaEvents: MediaEventsPort,
        @Inject(EVENT_RECEIPTS) private readonly receipts: EventReceiptsPort,
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
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
}

export const MEDIA_EVENT_COMMAND_HANDLERS = [ApplyMediaEventHandler]
