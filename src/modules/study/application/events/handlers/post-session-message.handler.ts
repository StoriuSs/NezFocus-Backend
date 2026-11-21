import { Logger } from '@nestjs/common'
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { PostStudySessionCommand, StudySessionNotice } from '@/modules/messaging'
import { FocusSessionChangedEvent } from '../focus-session-changed.event'

/**
 * "{who} đã bắt đầu phiên học 25/5" when a Room Session starts, and "Phiên
 * học đã kết thúc" when it ends, in the room's chat (REQ-MSG-08, D-222),
 * through messaging's PostStudySessionCommand over the bus. Nothing for the
 * changes between. A failure is logged and thrown: the session is saved,
 * and the message is lost.
 */
@EventsHandler(FocusSessionChangedEvent)
export class PostSessionMessageHandler implements IEventHandler<FocusSessionChangedEvent> {
    private readonly logger = new Logger(PostSessionMessageHandler.name)

    constructor(private readonly commandBus: CommandBus) {}

    async handle({ before, after, actorId }: FocusSessionChangedEvent): Promise<void> {
        const { kind, serverId, channelId } = after
        if (kind !== 'room' || !serverId || !channelId) return
        const notice: StudySessionNotice | null =
            !before && actorId
                ? {
                      event: 'study_session_started',
                      userId: actorId,
                      sessionId: after.id,
                      focusMinutes: after.cycle.focusMinutes,
                      shortBreakMinutes: after.cycle.shortBreakMinutes
                  }
                : before && before.status !== 'ended' && after.endedReason
                  ? { event: 'study_session_ended', sessionId: after.id, reason: after.endedReason }
                  : null
        if (!notice) return
        try {
            await this.commandBus.execute(new PostStudySessionCommand(serverId, channelId, notice))
        } catch (error) {
            this.logger.error(`The message of session ${after.id} not written: ${String(error)}`)
            throw error
        }
    }
}
