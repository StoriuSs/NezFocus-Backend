import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { SessionsEndedEvent } from '@/modules/auth'
import { CALL_MEDIA, type CallMediaPort } from '@/modules/voice'
import { CALL_REPOSITORY, CallRepositoryPort } from '../../../domain'
import { CALL_JOBS, CallJobsPort } from '../../ports'
import { MediaSources, recordMedia } from '../../services/call-room'

/**
 * Sign-in sessions ended (signing out, a password change, revoked, a
 * deleted account...): the call connections they made leave their rooms at
 * once, as voice's do (D-214), and are marked out, so the call ends 30
 * seconds on unless its person comes back from another sign-in (D-242, the
 * backstop of L4-g). Only those connections: a newer one of the same
 * account stays. A join of an ended session that comes later is put out by
 * voice on its webhook.
 *
 * Not retried (adding-a-module.md › Events): a connection LiveKit could not
 * be asked to end keeps its row, and its tab signs out, which leaves.
 */
@EventsHandler(SessionsEndedEvent)
export class LeaveEndedSessionCallsHandler implements IEventHandler<SessionsEndedEvent> {
    private readonly logger = new Logger(LeaveEndedSessionCallsHandler.name)
    private readonly sources: MediaSources

    constructor(
        @Inject(CALL_REPOSITORY) calls: CallRepositoryPort,
        @Inject(CALL_JOBS) jobs: CallJobsPort,
        @Inject(CALL_MEDIA) media: CallMediaPort,
        events: EventBus
    ) {
        this.sources = { calls, jobs, events, media }
    }

    async handle({ sessionIds }: SessionsEndedEvent): Promise<void> {
        let connections
        try {
            connections = await this.sources.calls.inSessions(sessionIds)
        } catch (error) {
            this.logger.warn(`Call rooms of ended sessions not read: ${(error as Error)?.message}`)
            return
        }
        for (const { callId, row } of connections) {
            try {
                await this.sources.media.removeConnection(callId, row.userId, row.participantSid)
                await recordMedia(this.sources, callId, {
                    kind: 'left',
                    userId: row.userId,
                    participantSid: row.participantSid,
                    at: new Date()
                })
            } catch (error) {
                this.logger.warn(
                    `Call ${callId} of ${row.userId} not left after their session ended: ${(error as Error)?.message}`
                )
            }
        }
    }
}
