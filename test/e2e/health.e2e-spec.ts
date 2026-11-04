import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { DiskHealthIndicator } from '@nestjs/terminus'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Logger as PinoLogger } from 'nestjs-pino'
import request from 'supertest'
import { HealthModule } from '@/health/health.module'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { GlobalExceptionFilter } from '@/shared/presentation/filters/global-exception.filter'
import { TransformInterceptor } from '@/shared/presentation/interceptors/transform.interceptor'

/** The health endpoints, with the database and Redis replaced by controllable fakes. */
describe('Health endpoints (e2e)', () => {
    let app: INestApplication
    const originalEnv = process.env.NODE_ENV

    afterEach(async () => {
        await app?.close()
        process.env.NODE_ENV = originalEnv
    })

    it('does not reveal dependency error text in production', async () => {
        process.env.NODE_ENV = 'production'
        const database = {
            $queryRaw: jest.fn().mockRejectedValue(new Error("Can't reach database server at `postgres:5432`"))
        }
        const redis = { ping: jest.fn().mockResolvedValue('PONG'), incr: jest.fn(), pExpire: jest.fn() }
        const moduleRef = await Test.createTestingModule({
            imports: [
                {
                    module: class FakeInfrastructure {},
                    global: true,
                    providers: [
                        { provide: PrismaService, useValue: database },
                        { provide: REDIS_CLIENT, useValue: redis }
                    ],
                    exports: [PrismaService, REDIS_CLIENT]
                },
                HealthModule
            ],
            providers: [
                { provide: PinoLogger, useValue: { error: jest.fn(), warn: jest.fn(), log: jest.fn() } },
                { provide: APP_INTERCEPTOR, useClass: TransformInterceptor }
            ]
        })
            // The real check asks the OS (WMI on Windows), which can fail on a
            // developer's machine for reasons that have nothing to do with
            // this test: the answer was then a 500 instead of the 503.
            .overrideProvider(DiskHealthIndicator)
            .useValue({ checkStorage: async (key: string) => ({ [key]: { status: 'up' } }) })
            .compile()
        app = moduleRef.createNestApplication()
        app.useGlobalFilters(new GlobalExceptionFilter(moduleRef.get(PinoLogger)))
        await app.init()

        const res = await request(app.getHttpServer()).get('/health').expect(503)

        expect(JSON.stringify(res.body)).not.toContain('postgres:5432')
        expect(JSON.stringify(res.body)).toContain('database')
    })
})
