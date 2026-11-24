/**
 * What other modules may use from voice. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). VoiceModule and RoomPeopleModule themselves are imported from
 * './voice.module'.
 */

// Someone came into a voice room, went out, or their icons changed: study hears joins and leaves (M5).
export { VoiceStateChangedEvent } from './application/events/voice-state-changed.event'
// Someone asked to leave their room: study closes their place at once, even when LiveKit's leave came first (D-228).
export { VoiceLeaveRequestedEvent } from './application/events/voice-leave-requested.event'

// Who is in a voice room now: study starts a session from inside its room, with everyone in it (D-225).
export { VOICE_ROOMS, type RoomOccupancy, type VoiceRoomsPort } from './application/ports/voice-rooms.port'

// The media rooms of one-to-one calls, for social, which keeps the calls (D-239): tokens, who is in, putting out, closing;
// what happens in them comes as CallMediaChangedEvent. Social answers ACTIVE_CALLS: joining a voice room ends one's call (D-246).
export { CALL_MEDIA, type CallConnection, type CallMediaPort } from './application/ports/call-media.port'
export { CallMediaChangedEvent, type CallRoomChange } from './application/events/call-media-changed.event'
export { ACTIVE_CALLS, type ActiveCallsPort } from './application/ports/active-calls.port'

// Run on a schedule by src/maintenance (D-210).
export { ReconcileVoiceRoomsCommand } from './application/commands/reconcile/reconcile.commands'
