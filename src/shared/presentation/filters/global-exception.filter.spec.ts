import { ArgumentsHost, PayloadTooLargeException } from '@nestjs/common'
import { Logger as PinoLogger } from 'nestjs-pino'
import { CustomException } from '@/shared/presentation/exceptions'
import { GlobalExceptionFilter } from './global-exception.filter'

jest.mock('@/shared/infrastructure/monitoring/error-reporting', () => ({ reportError: jest.fn() }))

function httpHost(request: object): ArgumentsHost {
    const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        getHeader: () => undefined,
        setHeader: jest.fn()
    }
    return {
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => response })
    } as unknown as ArgumentsHost
}

const baseRequest = { method: 'POST', url: '/api/v1/users/me/avatar', requestId: 'req-1', startTime: Date.now() }
const logger = { error: jest.fn(), warn: jest.fn() } as unknown as PinoLogger

describe('GlobalExceptionFilter', () => {
    it("keeps Google's one-time code and state out of the log and the response", () => {
        const host = httpHost({ ...baseRequest, url: '/api/v1/auth/google/callback?code=4%2F0Ab&state=st4te-xyz' })
        new GlobalExceptionFilter(logger).catch(new TypeError('boom'), host)

        const logged = JSON.stringify(jest.mocked(logger.error).mock.calls.at(-1))
        const response = host.switchToHttp().getResponse<{ json: jest.Mock }>()
        const returned = JSON.stringify(response.json.mock.calls[0][0])
        for (const text of [logged, returned]) {
            expect(text).not.toContain('4%2F0Ab')
            expect(text).not.toContain('st4te-xyz')
        }
    })

    it('logs what a failed upload says underneath, and answers only that it failed', () => {
        const failed = new CustomException({
            code: '500002',
            type: 'UPLOAD_FAILED',
            message: 'File upload failed',
            status: 500,
            cause: new Error('Failed to upload buffer to S3: getaddrinfo ENOTFOUND minio.internal')
        })
        const host = httpHost(baseRequest)
        new GlobalExceptionFilter(logger).catch(failed, host)

        const response = host.switchToHttp().getResponse<{ status: jest.Mock; json: jest.Mock }>()
        const body = JSON.stringify(response.json.mock.calls[0][0])
        expect(response.status).toHaveBeenCalledWith(500)
        expect(body).toContain('File upload failed')
        expect(body).not.toContain('minio.internal')
        expect(JSON.stringify(jest.mocked(logger.error).mock.calls.at(-1))).toContain(
            'getaddrinfo ENOTFOUND minio.internal'
        )
    })

    it("names a file over its route's limit UPLOAD_FILE_TOO_LARGE, and a JSON body over its own PAYLOAD_TOO_LARGE", () => {
        const typeFor = (exception: unknown) => {
            const host = httpHost(baseRequest)
            new GlobalExceptionFilter(logger).catch(exception, host)
            const response = host.switchToHttp().getResponse<{ status: jest.Mock; json: jest.Mock }>()
            return [response.status.mock.calls[0][0], response.json.mock.calls[0][0].meta.type]
        }
        // What FileInterceptor throws for multer's LIMIT_FILE_SIZE.
        expect(typeFor(new PayloadTooLargeException('File too large'))).toEqual([413, 'UPLOAD_FILE_TOO_LARGE'])
        // What body-parser throws (an http-errors error, not an HttpException).
        const bodyTooLarge = Object.assign(new Error('request entity too large'), { status: 413, expose: true })
        expect(typeFor(bodyTooLarge)).toEqual([413, 'PAYLOAD_TOO_LARGE_ERROR'])
    })
})
