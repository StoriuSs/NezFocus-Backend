import { Inject, Injectable } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { SESSION_CACHE, SessionCachePort } from '../ports'
import { SessionsEndedEvent } from '../events/sessions-ended.event'

/**
 * What follows sessions ending, once their rows say so: the cache stops
 * honouring their access tokens, and the other modules hear of it
 * (SessionsEndedEvent: the realtime module cuts their sockets off).
 *
 * Every handler that ends sessions calls this rather than the cache itself,
 * so a new way to end one cannot forget the sockets (a test in
 * session-ends.spec.ts looks for direct calls).
 *
 * The cache goes first: a socket connecting while this runs checks its
 * session there, so by the time the event cuts the session's sockets off, a
 * new one is refused. The event goes out even when the cache could not be
 * reached (a socket left open would keep hearing events for someone signed
 * out); that failure is still thrown, for the caller to handle as before.
 */
@Injectable()
export class SessionEnds {
    constructor(
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        private readonly events: EventBus
    ) {}

    async ended(sessionIds: string[]): Promise<void> {
        if (sessionIds.length === 0) return
        try {
            await this.cache.invalidateSessions(sessionIds)
        } finally {
            this.events.publish(new SessionsEndedEvent(sessionIds))
        }
    }
}
