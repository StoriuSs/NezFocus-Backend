import { Injectable, OnModuleInit } from '@nestjs/common'
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { reportError } from '@/shared/infrastructure/monitoring/error-reporting'
import { AUTH_EVENT_NAMES, AuthEvent, AuthEventSubject, AuthEventsPort } from '@/modules/auth/application/ports'

/**
 * The events that are an incident, not only a number: each is also sent to
 * error tracking, with whom it concerns, so someone can follow it up. The tag
 * is what the runbook filters on (docs/auth/operations.md).
 */
const INCIDENTS: Partial<Record<AuthEvent, { message: string; tag: string }>> = {
    refresh_reuse_detected: { message: 'Refresh token reuse detected', tag: 'refresh-reuse' }
}

/**
 * Counts auth events on `auth_events_total{event}`, for the dashboards and
 * alerts, and reports the INCIDENTS among them to error tracking.
 */
@Injectable()
export class PrometheusAuthEvents implements AuthEventsPort, OnModuleInit {
    constructor(private readonly metrics: MetricsService) {}

    /**
     * Every event at 0 from the start. Prometheus' increase() cannot count a
     * series' first sample, so a counter that first appears at 1 — the first
     * refresh-token reuse since the app started — would never alert.
     */
    onModuleInit(): void {
        for (const event of AUTH_EVENT_NAMES) this.metrics.recordAuthEvent(event, 0)
    }

    record(event: AuthEvent, subject?: AuthEventSubject): void {
        this.metrics.recordAuthEvent(event)
        const incident = INCIDENTS[event]
        if (incident) {
            reportError(new Error(incident.message), {
                userId: subject?.userId,
                tags: { auth: incident.tag },
                extra: { sessionId: subject?.sessionId }
            })
        }
    }
}
