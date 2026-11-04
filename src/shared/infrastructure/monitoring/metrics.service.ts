import { Injectable } from '@nestjs/common'
import { Counter, Histogram, Gauge } from 'prom-client'
import { InjectMetric } from '@willsoto/nestjs-prometheus'

@Injectable()
export class MetricsService {
    constructor(
        @InjectMetric('http_requests_total')
        public readonly httpRequestsTotal: Counter<string>,

        @InjectMetric('http_request_duration_seconds')
        public readonly httpRequestDuration: Histogram<string>,

        @InjectMetric('http_active_requests')
        public readonly httpActiveRequests: Gauge<string>,

        @InjectMetric('db_query_duration_seconds')
        public readonly dbQueryDuration: Histogram<string>,

        @InjectMetric('db_queries_total')
        public readonly dbQueriesTotal: Counter<string>,

        @InjectMetric('cache_hits_total')
        public readonly cacheHits: Counter<string>,

        @InjectMetric('cache_misses_total')
        public readonly cacheMisses: Counter<string>,

        @InjectMetric('auth_events_total')
        public readonly authEvents: Counter<string>
    ) {}

    /**
     * Record an HTTP request metric
     */
    recordRequest(method: string, path: string, statusCode: number, duration: number) {
        this.httpRequestsTotal.inc({
            method,
            path,
            status_code: String(statusCode)
        })

        this.httpRequestDuration.observe({ method, path }, duration / 1000) // Convert ms to seconds
    }

    /**
     * Increment active request count
     */
    incrementActiveRequests() {
        this.httpActiveRequests.inc()
    }

    /**
     * Decrement active request count
     */
    decrementActiveRequests() {
        this.httpActiveRequests.dec()
    }

    /**
     * Record a database query metric
     */
    recordDbQuery(operation: string, durationMs: number) {
        this.dbQueriesTotal.inc({ operation })
        this.dbQueryDuration.observe({ operation }, durationMs / 1000)
    }

    /**
     * Record a cache hit. `cache` names the cache (a label: keep it to a few
     * fixed names, never a key).
     */
    recordCacheHit(cache: string) {
        this.cacheHits.inc({ cache })
    }

    /**
     * Record a cache miss. `cache` as for recordCacheHit.
     */
    recordCacheMiss(cache: string) {
        this.cacheMisses.inc({ cache })
    }

    /**
     * Count a sign-in event: a failed login, a refresh token used twice.
     * `event` is one of a fixed set (see AuthEvent), never user data.
     */
    recordAuthEvent(event: string, by = 1) {
        this.authEvents.inc({ event }, by)
    }
}
