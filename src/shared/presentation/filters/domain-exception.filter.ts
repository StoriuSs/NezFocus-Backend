import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common'
import { Response } from 'express'
import { Logger as PinoLogger } from 'nestjs-pino'
import { ERROR_CODES, ERROR_TYPES, LOG_CONTEXT_HTTP } from '@/shared/constants'
import { ExtendedRequest } from '@/shared/types'
import { redactUrl } from '@/shared/constants/sensitive-fields'
import { DomainError, DomainErrorKind } from '@/shared/domain/domain-error'
import { toSnakeCaseKeys } from '@/shared/utils/case-keys.util'

const STATUS_BY_KIND: Record<DomainErrorKind, HttpStatus> = {
    invalid: HttpStatus.BAD_REQUEST,
    unauthenticated: HttpStatus.UNAUTHORIZED,
    forbidden: HttpStatus.FORBIDDEN,
    not_found: HttpStatus.NOT_FOUND,
    conflict: HttpStatus.CONFLICT,
    unprocessable: HttpStatus.UNPROCESSABLE_ENTITY,
    rate_limited: HttpStatus.TOO_MANY_REQUESTS,
    unavailable: HttpStatus.SERVICE_UNAVAILABLE,
    gone: HttpStatus.GONE
}

/**
 * The one place domain errors meet HTTP, for every module.
 *
 * Domain and application code throw DomainError subclasses; this maps each to
 * a status by its kind and to the catalogued code/type by its errorKey. Each
 * module used to need its own filter listing its own exceptions.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
    constructor(private readonly logger: PinoLogger) {}

    catch(exception: DomainError, host: ArgumentsHost) {
        const ctx = host.switchToHttp()
        const response = ctx.getResponse<Response>()
        const request = ctx.getRequest<ExtendedRequest>()

        const status = STATUS_BY_KIND[exception.kind]
        const duration = request.startTime ? Date.now() - request.startTime : undefined

        // A client-side outcome (4xx): warn, like the global filter.
        this.logger.warn(
            {
                msg: 'Domain exception caught',
                method: request.method,
                url: redactUrl(request.url),
                statusCode: status,
                duration,
                requestId: request.requestId,
                error: { name: exception.name, message: exception.message }
            },
            LOG_CONTEXT_HTTP
        )

        if (exception.retryAfterSeconds !== undefined) {
            response.setHeader('Retry-After', String(Math.max(1, Math.ceil(exception.retryAfterSeconds))))
        }

        response.status(status).json({
            meta: {
                code: ERROR_CODES[exception.errorKey],
                type: ERROR_TYPES[exception.errorKey],
                message: exception.message,
                timestamp: new Date().toISOString(),
                request_id: request.requestId,
                request_duration: duration
            },
            data: {
                // snake_case like every other answer: attemptsLeft goes out as attempts_left.
                ...(toSnakeCaseKeys(exception.details ?? {}) as Record<string, unknown>),
                details: exception.message,
                path: redactUrl(request.url),
                method: request.method
            }
        })
    }
}
