import { Global, Module } from '@nestjs/common'
import {
    PrometheusModule as NestPrometheusModule,
    makeCounterProvider,
    makeHistogramProvider,
    makeGaugeProvider
} from '@willsoto/nestjs-prometheus'
import { ConfigService } from '@nestjs/config'
import { MetricsService } from './metrics.service'
import { MetricsController } from './metrics.controller'

@Global()
@Module({
    imports: [
        NestPrometheusModule.registerAsync({
            useFactory: (configService: ConfigService) => ({
                defaultMetrics: {
                    enabled: configService.get('prometheus.defaultMetrics') ?? true,
                    config: {
                        // No prefix - allows compatibility with standard Grafana Hub dashboards
                        prefix: ''
                    }
                },
                defaultLabels: configService.get('prometheus.defaultLabels')
            }),
            // Route path and exemptions live on the controller itself.
            controller: MetricsController,
            inject: [ConfigService]
        })
    ],
    providers: [
        // Counter: Total HTTP requests
        makeCounterProvider({
            name: 'http_requests_total',
            help: 'Total number of HTTP requests',
            labelNames: ['method', 'path', 'status_code']
        }),
        // Histogram: Request duration distribution
        makeHistogramProvider({
            name: 'http_request_duration_seconds',
            help: 'Duration of HTTP requests in seconds',
            labelNames: ['method', 'path'],
            buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
        }),
        // Gauge: Currently active requests
        makeGaugeProvider({
            name: 'http_active_requests',
            help: 'Number of currently active HTTP requests'
        }),
        // Histogram: Database query duration
        makeHistogramProvider({
            name: 'db_query_duration_seconds',
            help: 'Duration of database queries in seconds',
            labelNames: ['operation'],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
        }),
        // Counter: Total database queries
        makeCounterProvider({
            name: 'db_queries_total',
            help: 'Total number of database queries',
            labelNames: ['operation']
        }),
        // Counter: Cache hits
        makeCounterProvider({
            name: 'cache_hits_total',
            help: 'Total number of cache hits',
            // Which cache: auth_user (the guard's user lookup), or your own.
            labelNames: ['cache']
        }),
        // Counter: Cache misses
        makeCounterProvider({
            name: 'cache_misses_total',
            help: 'Total number of cache misses',
            labelNames: ['cache']
        }),
        // Counter: sign-in events (failed logins, refresh-token reuse), for alerts
        makeCounterProvider({
            name: 'auth_events_total',
            help: 'Sign-in events: logins, failures, rate limiting, refresh-token reuse',
            labelNames: ['event']
        }),
        MetricsService
    ],
    exports: [NestPrometheusModule, MetricsService]
})
export class PrometheusModule {}
