import { EventBus } from '@nestjs/cqrs'
import { EventPublisherPort } from '@/modules/realtime'
import { DisconnectReason, leaveWrite, VoiceState, VoiceStateRepositoryPort, voiceRoomOf } from '../../domain'
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
 *
 * True when it put them out of something: LiveKit had them in the room, or
 * the row was theirs. False when they had left already.
 */
export async function leaveRoom({ media, states, events }: LeaveSources, state: VoiceState): Promise<boolean> {
    const connected = await media.removeParticipant(voiceRoomOf(state.channelId), state.userId)
    const result = await states.change(state.userId, (current) => leaveWrite(current, state.participantSid))
    for (const event of changeEvents(result)) events.publish(event)
    return connected || result !== null
}

/** What putting someone out and telling them why needs. */
export interface PutOutSources extends LeaveSources {
    publisher: EventPublisherPort
}

/**
 * Puts someone out of their room (leaveRoom), then tells their own tabs why
 * (`voice.disconnected { channel_id, reason }`, SRS 5.2), never who did it
 * (D-212): LiveKit itself only says they were removed. Told only when they
 * were put out of something (one who left meanwhile hears nothing), and
 * once LiveKit has done it, so a room it cannot reach tells nothing. True
 * when they were.
 */
export async function putOut(sources: PutOutSources, state: VoiceState, reason: DisconnectReason): Promise<boolean> {
    const out = await leaveRoom(sources, state)
    if (out) sources.publisher.toUser(state.userId, 'voice.disconnected', { channelId: state.channelId, reason })
    return out
}
