/**
 * What other modules may use from study. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). StudyModule itself is imported from './study.module'.
 *
 * RoomSessionsModule (servers' ROOM_SESSIONS, D-220) is imported from
 * './study.module' too.
 */

// Each person's Solo, and when a session changes: social's study activity line (D-240, D-247).
export { SOLO_SESSIONS, type SoloSessionsPort, type SoloState } from './application/ports/solo-sessions.port'
export { FocusSessionChangedEvent } from './application/events/focus-session-changed.event'
// Run every minute by src/maintenance: the phase ends whose job was lost or is late (D-225).
export { SweepStudyTimersCommand } from './application/commands/session-timer/session-timer.commands'
