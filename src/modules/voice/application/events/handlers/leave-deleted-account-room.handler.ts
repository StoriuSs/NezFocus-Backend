import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { AccountDeletionRequestedEvent } from '@/modules/auth'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { MEDIA_ROOMS, MediaRoomsPort } from '../../ports'
import { leaveRoom } from '../../services/leave-room'

/**
 * An account that started to wait for deletion (REQ-AUTH-09) leaves the
 * voice room it is in at once (D-210): others see it as deleted from now on
 * (D-182). Nothing is told: its sessions have ended, and no tab of it hears
 * anything (D-212).
 *
 * Not retried (adding-a-module.md › Events): its sessions ended, so its
 * tabs sign out, which leaves the room (the client's sign-out path); the
 * row goes with LiveKit's participant_left.
 */
@EventsHandler(AccountDeletionRequestedEvent)
export class LeaveDeletedAccountRoomHandler implements IEventHandler<AccountDeletionRequestedEvent> {
    private readonly logger = new Logger(LeaveDeletedAccountRoomHandler.name)

    constructor(
        @Inject(MEDIA_ROOMS) private readonly media: MediaRoomsPort,
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        private readonly events: EventBus
    ) {}

    async handle({ userId }: AccountDeletionRequestedEvent): Promise<void> {
        const state = await this.states.find(userId)
        if (!state) return
        try {
            await leaveRoom({ media: this.media, states: this.states, events: this.events }, state)
        } catch (error) {
            this.logger.warn(`Voice room of the deleted account ${userId} not left: ${(error as Error)?.message}`)
        }
    }
}
