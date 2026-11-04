import { Injectable, OnModuleInit, OnApplicationShutdown, Logger, Inject } from '@nestjs/common'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { MetricsService } from '../../monitoring/metrics.service'

/**
 * Injection token for the underlying pg connection pool.
 *
 * The pool is provided separately from the Prisma client so that shutdown can
 * actually close it. `@prisma/adapter-pg` only ends an externally supplied pool
 * when `disposeExternalPool` is set, so `$disconnect()` alone leaves the
 * sockets open and referenced — the process then never exits on its own and is
 * SIGKILLed by Docker, cutting in-flight requests and defeating the graceful
 * shutdown handling elsewhere in this app.
 */
export const PG_POOL = Symbol('PG_POOL')

/**
 * Factory function to create an extended Prisma client with monitoring and best practices.
 */
export function createExtendedPrismaClient(metrics: MetricsService, pool: Pool) {
    const adapter = new PrismaPg(pool)
    const client = new PrismaClient({ adapter })

    return client.$extends({
        query: {
            $allModels: {
                async $allOperations({
                    operation,
                    args,
                    query
                }: {
                    operation: string
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    args: any
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    query: (args: any) => Promise<any>
                }) {
                    const start = Date.now()
                    try {
                        const result = await query(args)
                        const duration = Date.now() - start
                        metrics.recordDbQuery(operation, duration)
                        return result
                    } catch (error) {
                        const duration = Date.now() - start
                        metrics.recordDbQuery(operation, duration)
                        throw error
                    }
                }
            }
        }
    })
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>

/**
 * This class serves as the injection token for the Prisma service.
 * In the module, we provide a factory that returns the extended client instance.
 * We use an interface with the same name to merge types and provide full autocompletion.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface PrismaService extends ExtendedPrismaClient {}
@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PrismaService {
    constructor() {
        // The actual instance is returned by the factory in PrismaModule
    }
}

/**
 * Handles the database connection lifecycle (the extended client is an instance, so a separate service manages it).
 *
 * In onApplicationShutdown, not onModuleDestroy. Nest's close() runs
 * onModuleDestroy, then beforeApplicationShutdown, then stops the HTTP server,
 * then onApplicationShutdown. Closing here in onModuleDestroy cut this
 * connection while requests already in flight at SIGTERM were still running,
 * so a rolling deploy answered them with 500s.
 */
@Injectable()
export class PrismaLifecycleService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(PrismaLifecycleService.name)

    constructor(
        @Inject(PrismaService) private readonly prisma: ExtendedPrismaClient,
        @Inject(PG_POOL) private readonly pool: Pool
    ) {}

    async onModuleInit() {
        await this.prisma.$connect()
        this.logger.log('Prisma connected to database')
    }

    async onApplicationShutdown() {
        this.logger.log('Closing database connections')
        await this.prisma.$disconnect()

        // $disconnect() does not end an externally supplied pool — without this
        // the process keeps live sockets and never exits on SIGTERM.
        try {
            await this.pool.end()
        } catch {
            // Already ended; shutdown must not hang
        }

        this.logger.log('Database connections closed')
    }
}
