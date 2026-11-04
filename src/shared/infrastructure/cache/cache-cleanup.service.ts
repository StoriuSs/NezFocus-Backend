import { Injectable, OnApplicationShutdown, Inject, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager'

/**
 * Graceful cleanup of the 2-layer cache connections.
 *
 * In onApplicationShutdown, not onModuleDestroy. Nest's close() runs
 * onModuleDestroy, then beforeApplicationShutdown, then stops the HTTP server,
 * then onApplicationShutdown. Closing here in onModuleDestroy cut this
 * connection while requests already in flight at SIGTERM were still running,
 * so a rolling deploy answered them with 500s.
 */
@Injectable()
export class CacheCleanupService implements OnApplicationShutdown {
    private readonly logger = new Logger(CacheCleanupService.name)

    constructor(
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        private readonly configService: ConfigService
    ) {}

    async onApplicationShutdown() {
        // Through the logger: pino writes asynchronously, but flushes on exit.
        this.logger.log('Closing cache connections')

        const timeout = this.configService.get<number>('app.gracefulShutdownTimeout')!

        // Wrap in timeout to prevent hanging. The handle is cleared in
        // `finally` — an uncleared timer keeps the event loop alive for its
        // full duration, which both delays process exit and fires the warning
        // after cleanup has already succeeded.
        let timer: NodeJS.Timeout | undefined
        const cleanupPromise = this.cleanup()
        const timeoutPromise = new Promise<void>((resolve) => {
            timer = setTimeout(() => {
                this.logger.warn(`Cache cleanup timed out after ${timeout}ms, continuing`)
                resolve()
            }, timeout)
        })

        // Try to close Redis gracefully but give up after timeout if stuck
        try {
            await Promise.race([cleanupPromise, timeoutPromise])
        } finally {
            if (timer) clearTimeout(timer)
        }

        this.logger.log('Cache connections closed')
    }

    private async cleanup(): Promise<void> {
        try {
            // cache-manager v6 exposes the configured Keyv layers directly as
            // `stores` (L1 memory, L2 Redis). Disconnect each one; only the
            // Redis-backed Keyv actually holds a socket, but disconnect() is
            // safe to call on any Keyv instance.
            for (const store of this.cacheManager.stores ?? []) {
                try {
                    await store.disconnect()
                } catch {
                    // Ignore individual store errors — shutdown must not hang
                }
            }
        } catch (error) {
            this.logger.warn(`Cache cleanup failed, continuing: ${error.message}`)
        }
    }
}
