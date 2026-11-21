import { VoiceState } from '../../domain'
import { VoiceStateChangedEvent } from '../events/voice-state-changed.event'

/**
 * The events a change to someone's row makes (VoiceStateChangedEvent): none
 * when it wrote nothing. `lost`: the row went because LiveKit lost the
 * connection (D-215), as only a leaving write says (no row after it).
 */
export function changeEvents(
    result: { before: VoiceState | null; after: VoiceState | null } | null,
    lost = false
): VoiceStateChangedEvent[] {
    if (!result) return []
    const { before, after } = result
    if (before && after && before.channelId === after.channelId) {
        const change = before.participantSid === after.participantSid ? 'updated' : 'joined'
        return [new VoiceStateChangedEvent(after.channelId, after.userId, change, after.joinedAt)]
    }
    const events: VoiceStateChangedEvent[] = []
    if (before) {
        events.push(new VoiceStateChangedEvent(before.channelId, before.userId, 'left', before.joinedAt, lost))
    }
    if (after) events.push(new VoiceStateChangedEvent(after.channelId, after.userId, 'joined', after.joinedAt))
    return events
}
