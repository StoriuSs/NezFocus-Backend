import { CallHandler, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import { lastValueFrom, of } from 'rxjs'
import { LoggingInterceptor } from './logging.interceptor'

function contextFor(url: string): ExecutionContext {
    return {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({
            getRequest: () => ({ method: 'GET', url, requestId: 'req-1', startTime: Date.now() }),
            getResponse: () => ({ statusCode: 302 })
        })
    } as unknown as ExecutionContext
}

describe('LoggingInterceptor', () => {
    it("logs a completed request without Google's one-time code and state", async () => {
        const logger = { log: jest.fn() } as unknown as Logger
        const reflector = { getAllAndOverride: () => false } as unknown as Reflector
        const next: CallHandler = { handle: () => of(null) }

        await lastValueFrom(
            new LoggingInterceptor(logger, reflector).intercept(
                contextFor('/api/v1/auth/google/callback?code=4%2F0Ab&state=st4te-xyz'),
                next
            )
        )

        const [line] = jest.mocked(logger.log).mock.calls[0] as [{ url: string }]
        expect(line.url).toBe('/api/v1/auth/google/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D')
    })
})
