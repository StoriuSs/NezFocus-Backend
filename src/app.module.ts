import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure'
import { SentryModule } from '@sentry/nestjs/setup'

// Config imports
import {
    appConfig,
    databaseConfig,
    redisConfig,
    corsConfig,
    throttleConfig,
    authConfig,
    emailConfig,
    uploadConfig,
    timeoutConfig,
    prometheusConfig,
    pinoConfig,
    validationSchema,
    sentryOptions
} from '@/config'

// Shared imports
import { GlobalExceptionFilter, DomainExceptionFilter } from '@/shared/presentation'
import {
    TransformInterceptor,
    LoggingInterceptor,
    TimeoutInterceptor,
    IdempotencyInterceptor
} from '@/shared/presentation'
import { IdempotencyService } from '@/shared/infrastructure'
import { KeyvThrottlerStorage } from '@/shared/infrastructure'
import { THROTTLER_NAME } from '@/shared/presentation/decorators'
import { RequestContextGuard } from '@/shared/presentation'

// Core infrastructure modules
import { PrismaModule } from '@/shared/infrastructure'
import { CacheModule } from '@/shared/infrastructure'
import { BullModule } from '@nestjs/bullmq'
import { PrometheusModule } from '@/shared/infrastructure'
import { QueueObservabilityModule } from '@/shared/infrastructure/queue/queue-observability.module'
import { CqrsObservabilityModule } from '@/shared/infrastructure/monitoring/cqrs-failure-reporter'
import { AppLogger } from '@/shared/infrastructure/logging/app-logger'

// Infra modules
import { EmailModule } from '@/shared/infrastructure'
import { UploadModule } from '@/shared/infrastructure'

// Top-level modules
import { HealthModule } from '@/health/health.module'
import { MaintenanceModule } from '@/maintenance/maintenance.module'

// Feature modules (Hexagonal Architecture)
import { UsersModule } from '@/modules/users/users.module'
import { AuthModule } from '@/modules/auth/auth.module'
import { AccessTokenGuard, throttleByUser, TOKEN_SERVICE, type TokenServicePort } from '@/modules/auth'

// Guards
import { RolesGuard } from '@/shared/presentation'

@Module({
    imports: [
        // Configuration
        ConfigModule.forRoot({
            isGlobal: true,
            // Load .env.development or .env.production based on NODE_ENV.
            // Each file is complete and standalone — no base file merging.
            // When running in Docker, docker-compose injects vars via env_file
            // and the environment: block; this path is used for local dev without Docker.
            envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
            load: [
                appConfig,
                databaseConfig,
                redisConfig,
                corsConfig,
                throttleConfig,
                authConfig,
                emailConfig,
                uploadConfig,
                timeoutConfig,
                prometheusConfig
            ],
            validationSchema,
            // Report every invalid variable at once, not one per restart.
            validationOptions: {
                abortEarly: false
            }
        }),

        // Rate limiting backed directly by Redis (see KeyvThrottlerStorage for
        // why this must not go through the 2-layer cache)
        ThrottlerModule.forRootAsync({
            imports: [AuthModule],
            inject: [ConfigService, REDIS_CLIENT, TOKEN_SERVICE],
            useFactory: (configService: ConfigService, redis: RedisClientType, tokens: TokenServicePort) => {
                // Per user when the request carries a valid access token, per
                // IP network otherwise (D-135; throttle-by-user.ts).
                const { limit, getTracker } = throttleByUser(tokens, {
                    signedIn: configService.get<number>('throttle.limit')!,
                    anonymous: configService.get<number>('throttle.anonymousLimit')!
                })
                return {
                    throttlers: [
                        {
                            name: THROTTLER_NAME,
                            ttl: configService.get<number>('throttle.ttl')! * 1000, // Convert to milliseconds
                            limit
                        }
                    ],
                    storage: new KeyvThrottlerStorage(redis),

                    // The tracker: `user:<id>` or `ip:<network>`.
                    //
                    // This guard runs before authentication (see APP_GUARD
                    // ordering below), so `req.user` is not set yet: the tracker
                    // checks the access token itself (signature and expiry). An
                    // expired or forged token counts per IP like no token.
                    //
                    // `req.ip` is only meaningful because `trust proxy` is set in
                    // main.ts. Without it Express reports the Nginx socket address
                    // and every client collapses into one bucket. IPv6 clients
                    // count per /64 (ipNetwork): one can use a new address of its
                    // /64 for every request.
                    getTracker

                    // Exemptions are declared on the route with @SkipRateLimit()
                    // (the metrics endpoint), not matched against the URL here.
                }
            }
        }),

        // Pino Logger
        LoggerModule.forRoot(pinoConfig),

        // Error tracking starts in src/instrument.ts. This module only names
        // traces after their route, so it is loaded only when tracing is on.
        ...(sentryOptions()?.tracesSampleRate ? [SentryModule.forRoot()] : []),

        // Core infrastructure
        PrismaModule,
        CacheModule,
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                connection: {
                    host: configService.get<string>('redis.host'),
                    port: configService.get<number>('redis.port'),
                    password: configService.get<string>('redis.password')
                }
            })
        }),
        PrometheusModule,
        // Job counts and errors of every queue registered below
        QueueObservabilityModule,
        // Failed CQRS event handlers into error tracking
        CqrsObservabilityModule,

        // Infra
        EmailModule,
        UploadModule,

        // Health
        HealthModule,

        // Feature modules (Hexagonal Architecture)
        UsersModule,
        AuthModule,

        // Every module's periodic jobs, on one schedule list
        MaintenanceModule
    ],
    providers: [
        // Never blocks: copies route metadata onto the request for the metrics
        // middleware. First, so it runs even when a later guard rejects.
        {
            provide: APP_GUARD,
            useClass: RequestContextGuard
        },
        // Global rate limiting guard.
        //
        // MUST be registered before the auth guard. Global guards run in
        // registration order, and the auth guard throws on a missing or
        // invalid token — so with the old ordering, unauthenticated traffic
        // (the traffic rate limiting exists for) never reached the throttler.
        // The cost of this ordering is that `getTracker` cannot see
        // `req.user`: it checks the access token itself (throttle-by-user.ts)
        // to count signed-in requests per user and the rest per IP (D-135).
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard
        },
        // Global authentication guard (all routes protected by default).
        // useExisting: the one instance AuthModule builds, with its ports.
        {
            provide: APP_GUARD,
            useExisting: AccessTokenGuard
        },
        // Role-based access control guard
        {
            provide: APP_GUARD,
            useClass: RolesGuard
        },
        // Global exception filters
        {
            provide: APP_FILTER,
            useClass: GlobalExceptionFilter
        },
        // Maps every module's DomainError subclasses to HTTP responses
        {
            provide: APP_FILTER,
            useClass: DomainExceptionFilter
        },
        // Global response transformation
        {
            provide: APP_INTERCEPTOR,
            useClass: TransformInterceptor
        },
        // Global logging
        {
            provide: APP_INTERCEPTOR,
            useClass: LoggingInterceptor
        },
        // Global timeout, then idempotency — order matters. Global interceptors
        // run in registration order, index 0 outermost, so Timeout wraps
        // Idempotency.
        //
        // A timeout answers the client but does not stop the handler. With
        // Timeout outside, it only tears down Idempotency's outer stream, and
        // Idempotency keeps following the handler to record how it really
        // ended: a retry after a 408 gets 409 while the work is still running
        // and the stored result once it is done. With Timeout inside, the
        // timeout reached Idempotency as an error, released the key, and the
        // retry ran the operation a second time.
        {
            provide: APP_INTERCEPTOR,
            useClass: TimeoutInterceptor
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: IdempotencyInterceptor
        },
        IdempotencyService,
        // The Nest logger (main.ts): nestjs-pino's, keeping errors passed as arguments
        AppLogger
    ]
})
// Request id and HTTP metrics middleware are registered in main.ts with
// app.use(), not configure(): MiddlewareConsumer routes get the global prefix,
// so requests outside /api would skip them.
export class AppModule {}
