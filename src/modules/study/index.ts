/**
 * What other modules may use from study. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). StudyModule itself is imported from './study.module'.
 *
 * RoomSessionsModule (servers' ROOM_SESSIONS, D-220) is imported from
 * './study.module' too.
 */

// Run every minute by src/maintenance: the phase ends whose job was lost or is late (D-225).
export { SweepStudyTimersCommand } from './application/commands/session-timer/session-timer.commands'
