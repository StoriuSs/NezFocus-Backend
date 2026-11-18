import { EventBus } from '@nestjs/cqrs'
import { leaveWrite, VoiceState, VoiceStateRepositoryPort, voiceRoomOf } from '../../domain'
import { MediaRoomsPort } from '../ports'
import { changeEvents } from './voice-changes'

/** What putting someone out of their room needs. */
export interface LeaveSources {
    media: MediaRoomsPort
    states: VoiceStateRepositoryPort
    events: EventBus
}

/**
 * Ends the connection `state` holds and removes the row at once, without
 * waiting for LiveKit's participant_left (which then changes nothing): the
 * room's list moves now. LiveKit first, so a room it cannot reach leaves
 * the row as it is (SERVICE_UNAVAILABLE). A newer connection written
 * meanwhile keeps its row (leaveWrite).
 */
export async function leaveRoom({ media, states, events }: LeaveSources, state: VoiceState): Promise<void> {
    await media.removeParticipant(voiceRoomOf(state.channelId), state.userId)
    const result = await states.change(state.userId, (current) => leaveWrite(current, state.participantSid))
    for (const event of changeEvents(result)) events.publish(event)
}
