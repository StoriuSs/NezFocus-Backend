/**
 * What other modules may use from realtime. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). RealtimeModule itself is imported from './realtime.module'.
 */

// Send an event to a person, a server's members or a channel's viewers (SRS 5.2).
export { EVENT_PUBLISHER, type EventPublisherPort } from './application/ports/event-publisher.port'
