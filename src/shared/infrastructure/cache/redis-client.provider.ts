import { Provider, Logger, OnApplicationShutdown, Injectable, Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, RedisClientType } from 'redis'
import { throttledLog } from '@/shared/utils/log-throttle.util'

/**
 * Injection token for the raw Redis client.
 *
 * The 2-layer cache (`CACHE_MANAGER`) is the right tool for *caching*, but a
 * few call sites need to talk to Redis directly and must not be served by the
 * in-memory L1 layer:
 *
 * - Rate limiting needs an atomic `INCR`. Read-modify-write through the cache
 *   loses increments under concurrency, and an L1 hit would make counters
 *   diverge per replica.
 * - The Redis health check must actually reach Redis. Probing through the
 *   cache is satisfied by L1 and reports "up" while Redis is down.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT')

export const redisClientProvider: Provider = {
    provide: REDIS_CLIENT,
    inject: [ConfigService],
    useFactory: async (configService: ConfigService): Promise<RedisClientType> => {
        const logger = new Logger('RedisClient')
        const client: RedisClientType = createClient({
            socket: {
                host: configService.get<string>('redis.host'),
                port: configService.get<number>('redis.port'),
                // Cap the per-attempt backoff so a long outage still retries at
                // a steady, predictable interval instead of drifting to minutes.
                reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
                connectTimeout: 5000
            },
            password: configService.get<string>('redis.password') || undefined,
            // Fail commands immediately while disconnected instead of queueing
            // them.
            //
            // This matters far more than it looks: the throttler runs as the
            // first global guard, so it touches Redis on EVERY request. With the
            // default offline queue, a Redis outage leaves every request parked
            // forever waiting to reconnect — the whole API hangs, including
            // /health/live. Failing fast lets callers degrade deliberately (the
            // throttler fails open, the health check reports down).
            disableOfflineQueue: true
        })

        // Without a listener, a connection drop surfaces as an unhandled
        // 'error' event and takes the process down. Logged once a minute while
        // it repeats: the client retries every few seconds during an outage.
        const logError = throttledLog((message) => logger.error(message), 60_000)
        client.on('error', (error: Error) =>
            logError(`Redis client error: ${error.message || error.name || String(error)}`)
        )

        // Bound the INITIAL connect.
        //
        // `reconnectStrategy` deliberately retries forever so a Redis restart
        // heals on its own at runtime — but that same strategy makes the first
        // connect hang indefinitely when Redis is simply not there, leaving the
        // process alive but never listening. An orchestrator can restart a
        // container that exits; it cannot do anything with one that hangs.
        const startupTimeoutMs = 15_000
        let timer: NodeJS.Timeout | undefined
        try {
            await Promise.race([
                client.connect(),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `Could not reach Redis within ${startupTimeoutMs}ms — check REDIS_HOST/REDIS_PORT/REDIS_PASSWORD`
                                )
                            ),
                        startupTimeoutMs
                    )
                })
            ])
        } catch (error) {
            client.disconnect().catch(() => undefined)
            throw error
        } finally {
            if (timer) clearTimeout(timer)
        }

        return client
    }
}

/**
 * Closes the raw Redis client on shutdown so the process can exit.
 *
 * In onApplicationShutdown, not onModuleDestroy. Nest's close() runs
 * onModuleDestroy, then beforeApplicationShutdown, then stops the HTTP server,
 * then onApplicationShutdown. Closing here in onModuleDestroy cut this
 * connection while requests already in flight at SIGTERM were still running,
 * so a rolling deploy answered them with 500s.
 */
@Injectable()
export class RedisClientCleanupService implements OnApplicationShutdown {
    constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClientType) {}

    async onApplicationShutdown() {
        try {
            await this.client.quit()
        } catch {
            // Already closed or never connected — shutdown must not hang
        }
    }
}
