import { Test } from '@nestjs/testing'
import { Controller, Get, INestApplication } from '@nestjs/common'
import { Logger as PinoLogger } from 'nestjs-pino'
import request from 'supertest'
import { GlobalExceptionFilter } from '@/shared/presentation/filters/global-exception.filter'

@Controller('boom')
class BoomController {
    @Get('unhandled')
    unhandled() {
        // A programming error, not a client error
        throw new TypeError('cannot read properties of undefined')
    }
}

/**
 * The filter used to attach `exception.stack` to the response body
 * unconditionally, disclosing absolute paths, dependency internals and module
 * layout to any caller in production.
 */
describe('GlobalExceptionFilter (e2e)', () => {
    let app: INestApplication
    const originalEnv = process.env.NODE_ENV

    afterEach(async () => {
        await app?.close()
        process.env.NODE_ENV = originalEnv
    })

    it('answers an unhandled error with a 500 and no stack trace or internal message in production', async () => {
        // The filter resolves its mode in the constructor.
        process.env.NODE_ENV = 'production'
        const moduleRef = await Test.createTestingModule({
            controllers: [BoomController],
            providers: [{ provide: PinoLogger, useValue: { error: jest.fn(), log: jest.fn(), warn: jest.fn() } }]
        }).compile()
        app = moduleRef.createNestApplication()
        app.useGlobalFilters(new GlobalExceptionFilter(moduleRef.get(PinoLogger)))
        await app.init()

        const res = await request(app.getHttpServer()).get('/boom/unhandled').expect(500)

        expect(res.body.data?.stack).toBeUndefined()
        expect(JSON.stringify(res.body)).not.toContain('cannot read properties of undefined')
    })
})
