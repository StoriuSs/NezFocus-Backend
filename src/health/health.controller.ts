import { Controller, Get, Inject, Injectable } from '@nestjs/common'
import {
    HealthCheckService,
    HealthCheck,
    HealthIndicator,
    HealthIndicatorResult,
    MemoryHealthIndicator,
    DiskHealthIndicator
} from '@nestjs/terminus'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ExcludeFromMetrics, Public, SkipSuccessLog } from '@/shared/presentation/decorators'
import { MESSAGES } from '@/shared/constants'
import { createResponse } from '@/shared/types'
import { ThrottlerHealthIndicator } from './throttler.health'
import { failureDetail } from './failure-detail'

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
    constructor(private readonly prismaService: PrismaService) {
        super()
    }

    async pingCheck(key: string): Promise<HealthIndicatorResult> {
        try {
            await this.prismaService.$queryRaw`SELECT 1`
            return this.getStatus(key, true)
        } catch (error) {
            return this.getStatus(key, false, failureDetail(error))
        }
    }
}

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {
        super()
    }

    async pingCheck(key: string): Promise<HealthIndicatorResult> {
        try {
            // PING the server directly.
            //
            // Probing through CACHE_MANAGER does not work: the in-memory L1
            // layer answers the read before Redis is ever consulted, so the
            // check reported "up" with Redis completely down.
            const pong = await this.redis.ping()

            if (pong === 'PONG') {
                return this.getStatus(key, true)
            }
            return this.getStatus(key, false, failureDetail(new Error(`Unexpected PING reply: ${pong}`)))
        } catch (error) {
            return this.getStatus(key, false, failureDetail(error))
        }
    }
}

/**
 * Three probes, from cheapest to most thorough:
 *
 * - `live`  — the process is up and serving HTTP. Checks nothing else, so a
 *   database outage doesn't get the container restarted (which wouldn't fix
 *   it). Docker's healthcheck uses this.
 * - `ready` — the dependencies needed to serve a request answer: database and
 *   Redis. For a load balancer deciding whether to send traffic.
 * - `/health` — everything, including memory and disk. For humans and alerts.
 *
 * Probed constantly, so kept out of request metrics and success logs; a
 * failing check is still logged by the exception filter. Rate-limited like
 * any other public route.
 */
@Controller('health')
@Public()
@ExcludeFromMetrics()
@SkipSuccessLog()
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly prismaHealth: PrismaHealthIndicator,
        private readonly redisHealth: RedisHealthIndicator,
        private readonly throttlerHealth: ThrottlerHealthIndicator,
        private readonly memory: MemoryHealthIndicator,
        private readonly disk: DiskHealthIndicator
    ) {}

    @Get()
    @HealthCheck()
    async check() {
        return this.health.check([
            () => this.prismaHealth.pingCheck('database'),
            () => this.redisHealth.pingCheck('redis'),
            // Rate limiter check (throttler with Redis storage)
            () => this.throttlerHealth.pingCheck('rate_limiter'),
            // Memory check (heap should not exceed 150MB)
            () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
            // Memory check (RSS should not exceed 300MB)
            () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
            // Disk check - thresholdPercent is MAX used allowed (0.9 = fail if > 90% used)
            () => this.disk.checkStorage('storage', { path: process.cwd(), thresholdPercent: 0.9 })
        ])
    }

    /** 503 when the database or Redis is unreachable. */
    @Get('ready')
    @HealthCheck()
    async readiness() {
        return this.health.check([
            () => this.prismaHealth.pingCheck('database'),
            () => this.redisHealth.pingCheck('redis')
        ])
    }

    @Get('live')
    liveness() {
        // Through createResponse: a plain { message, data } object is payload
        // to TransformInterceptor, and would come back wrapped twice.
        return createResponse(MESSAGES.HEALTH.CHECK_SUCCESS, {
            status: 'ok',
            uptime: process.uptime()
        })
    }
}
