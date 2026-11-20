import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { PRINCIPAL, PrincipalPort } from '@/modules/auth'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { DomainError } from '@/shared/domain/domain-error'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import {
    channelOfRoom,
    joinWrite,
    leaveWrite,
    ScreenAlreadySharedError,
    shareWrite,
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
    MediaEvent,
    MediaEventsPort,
    MediaRoomsPort
} from '../../ports'
import { standingOf } from '../../services/room-recheck'
import { changeEvents } from '../../services/voice-changes'
import { ApplyMediaEventCommand } from './media-event.commands'

type ShareEvent = Extract<MediaEvent, { kind: 'share_started' | 'share_stopped' }>
const isShare = (event: MediaEvent): event is ShareEvent =>
    event.kind === 'share_started' || event.kind === 'share_stopped'

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
 *
 * A screen started or stopped marks its person sharing or not, for the
 * connection the row holds (D-101). One room shares one screen: a second
 * (two people starting at once, or a Share button not yet off) meets the
 * partial unique index, and its track is muted at LiveKit and its person
 * told who shares (`voice.share_rejected`); their app takes it down.
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
        private readonly events: EventBus,
        @Inject(PRINCIPAL) private readonly principals: PrincipalPort
    ) {}

    async execute({ body, authorization }: ApplyMediaEventCommand): Promise<void> {
        const event = await this.mediaEvents.read(body, authorization)
        if (event.kind === 'other') return
        const channelId = channelOfRoom(event.room)
        if (!channelId) return
        if (!(await this.receipts.firstSight(event.id))) return
        if (isShare(event)) {
            await this.share(event, channelId).catch(async (error: unknown) => {
                await this.receipts.forget(event.id)
                throw error
            })
            return
        }

        const connection: VoiceConnection = {
            userId: event.identity,
            channelId,
            participantSid: event.participantSid,
            joinedAt: event.joinedAt,
            sessionId: event.sessionId
        }
        let result: Awaited<ReturnType<VoiceStateRepositoryPort['change']>>
        try {
            if (event.kind === 'joined' && !(await this.sessionLive(event))) return
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
     * Marks the screen of `event`'s connection started or stopped; a second
     * screen in the room is muted and its person told. LiveKit unreachable
     * throws, nobody told: the event is sent again.
     */
    private async share(event: ShareEvent, channelId: string): Promise<void> {
        const sharing = event.kind === 'share_started'
        let result: Awaited<ReturnType<VoiceStateRepositoryPort['change']>>
        try {
            result = await this.states.change(event.identity, (current) =>
                shareWrite(current, event.participantSid, sharing)
            )
        } catch (error) {
            if (!(error instanceof ScreenAlreadySharedError)) throw error
            await this.media.muteTrack(event.room, event.identity, event.trackSid)
            this.publisher.toUser(event.identity, 'voice.share_rejected', { channelId, userId: error.sharerId })
            return
        }
        for (const changed of changeEvents(result)) this.events.publish(changed)
    }

    /**
     * Whether the sign-in session the joining connection's token was issued
     * to is still live (D-214); if not, that connection is put out, not
     * listed, not told (its tabs are signed out). A token kept from before
     * the session ended would otherwise let someone who took it over back
     * in. A connection with no session (a token from before D-214) is taken
     * as before. The session store unreachable throws: the event is sent
     * again.
     */
    private async sessionLive(event: Extract<MediaEvent, { kind: 'joined' | 'left' }>): Promise<boolean> {
        if (!event.sessionId) return true
        try {
            await this.principals.resolve({ userId: event.identity, sessionId: event.sessionId })
            return true
        } catch (error) {
            // Any refusal of auth's (session ended, account gone): no infrastructure failure.
            if (!(error instanceof DomainError)) throw error
        }
        await this.media.removeConnection(event.room, event.identity, event.participantSid)
        return false
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
