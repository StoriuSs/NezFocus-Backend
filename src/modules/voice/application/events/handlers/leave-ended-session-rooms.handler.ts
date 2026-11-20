import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { SessionsEndedEvent } from '@/modules/auth'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { leaveConnection } from '../../services/leave-room'

/**
 * Sign-in sessions ended (signing out, a password change, revoked, a deleted
 * account...): the voice connections they made leave their rooms at once
 * (D-214). LiveKit renews a connected browser's token by itself, so without
 * this one taken over by someone else would stay in the room after the
 * owner changed the password. Only those connections: the same account in a
 * room from another sign-in stays, also one that joined since the row was
 * read (leaveConnection). The room gets its new list; the person is sent no
 * `voice.disconnected`: the session's sockets are cut too
 * (DisconnectEndedSessionsHandler). A join of an ended session that comes
 * later is put out on its webhook (ApplyMediaEventHandler).
 *
 * Not retried (adding-a-module.md › Events): a connection LiveKit could not
 * be asked to end keeps its row, and its tab signs out, which leaves.
 */
@EventsHandler(SessionsEndedEvent)
export class LeaveEndedSessionRoomsHandler implements IEventHandler<SessionsEndedEvent> {
    private readonly logger = new Logger(LeaveEndedSessionRoomsHandler.name)

    constructor(
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        private readonly events: EventBus
    ) {}

    async handle({ sessionIds }: SessionsEndedEvent): Promise<void> {
        let rows
        try {
            rows = await this.states.ofSessions(sessionIds)
        } catch (error) {
            this.logger.warn(`Voice rooms of ended sessions not read: ${(error as Error)?.message}`)
            return
        }
        for (const state of rows) {
            try {
                await leaveConnection({ media: this.media, states: this.states, events: this.events }, state)
            } catch (error) {
                this.logger.warn(
                    `Voice room of ${state.userId} not left after their session ended: ${(error as Error)?.message}`
                )
            }
        }
    }
}
