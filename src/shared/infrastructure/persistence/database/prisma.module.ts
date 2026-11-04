import { Module, Global } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Pool } from 'pg'
import { PrismaService, PrismaLifecycleService, createExtendedPrismaClient, PG_POOL } from './prisma.service'
import { MetricsService } from '../../monitoring/metrics.service'

@Global()
@Module({
    providers: [
        {
            provide: PG_POOL,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) =>
                new Pool({
                    connectionString: configService.get<string>('database.url'),
                    max: configService.get<number>('database.poolMax'),
                    idleTimeoutMillis: configService.get<number>('database.poolIdleTimeoutMs'),
                    connectionTimeoutMillis: configService.get<number>('database.poolConnectionTimeoutMs')
                })
        },
        {
            provide: PrismaService,
            inject: [MetricsService, PG_POOL],
            useFactory: (metrics: MetricsService, pool: Pool) => {
                return createExtendedPrismaClient(metrics, pool)
            }
        },
        PrismaLifecycleService
    ],
    exports: [PrismaService]
})
export class PrismaModule {}
