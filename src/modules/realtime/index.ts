/**
 * What other modules may use from realtime. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). RealtimeModule itself is imported from './realtime.module'.
 */

// Send an event to a person, a server's members or a channel's viewers (SRS 5.2).
export { EVENT_PUBLISHER, type EventPublisherPort } from './application/ports/event-publisher.port'

// Whom presence also goes to: a person's friends, answered by social (D-242).
export { FRIENDS, type FriendsPort } from './application/ports/friends.port'

// What others see of everyone not offline (REQ-AUTH-07), for @here (D-166).
export { PRESENCE, type PresencePort } from './application/ports/presence.port'
export type { Presence } from './domain/presence.rules'

// A tab typing in a channel, handed on to messaging (REQ-MSG-06).
export { TypingSignalledEvent } from './application/events/typing-signalled.event'
// A tab's microphone and camera in a voice room, handed on to voice (D-206).
export { VoiceSelfStateSignalledEvent } from './application/events/voice-self-state-signalled.event'

// Run on a schedule by src/maintenance (D-174).
export { SweepPresenceCommand } from './application/commands/presence/presence.commands'
