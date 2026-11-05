import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import { Response } from 'express'
import { Logger as PinoLogger } from 'nestjs-pino'
import { ERROR_TYPES, ERROR_CODES, LOG_CONTEXT_HTTP } from '@/shared/constants'
import { ExtendedRequest } from '@/shared/types'
import { redactUrl } from '@/shared/constants/sensitive-fields'
import { THROTTLER_NAME } from '../decorators/skip-rate-limit.decorator'
import { reportError } from '@/shared/infrastructure/monitoring/error-reporting'

interface HttpExceptionResponse {
    message?: string | string[]
    errors?: unknown
    type?: string
    code?: string
}

/**
 * Fallback error identity for exceptions that carry no `code`/`type` of their
 * own. Anything unmapped falls through to GENERIC — so every status Nest or its
 * middleware can raise on its own needs an entry, or the client receives e.g.
 * status 413 with code 500000: TimeoutInterceptor's RequestTimeoutException
 * (408), multer's file-size limit and body-parser's body limit (413), and
 * body-parser's unsupported charset/encoding (415).
 */
const STATUS_ERROR_MAP: Record<number, { type: string; code: string }> = {
    [HttpStatus.BAD_REQUEST]: { type: ERROR_TYPES.BAD_REQUEST, code: ERROR_CODES.BAD_REQUEST },
    [HttpStatus.UNAUTHORIZED]: { type: ERROR_TYPES.AUTH_UNAUTHORIZED, code: ERROR_CODES.AUTH_UNAUTHORIZED },
    [HttpStatus.FORBIDDEN]: { type: ERROR_TYPES.AUTH_FORBIDDEN, code: ERROR_CODES.AUTH_FORBIDDEN },
    [HttpStatus.NOT_FOUND]: { type: ERROR_TYPES.NOT_FOUND, code: ERROR_CODES.NOT_FOUND },
    [HttpStatus.REQUEST_TIMEOUT]: { type: ERROR_TYPES.REQUEST_TIMEOUT, code: ERROR_CODES.REQUEST_TIMEOUT },
    [HttpStatus.CONFLICT]: { type: ERROR_TYPES.CONFLICT, code: ERROR_CODES.CONFLICT },
    [HttpStatus.PAYLOAD_TOO_LARGE]: { type: ERROR_TYPES.PAYLOAD_TOO_LARGE, code: ERROR_CODES.PAYLOAD_TOO_LARGE },
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: {
        type: ERROR_TYPES.UNSUPPORTED_MEDIA_TYPE,
        code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE
    },
    [HttpStatus.UNPROCESSABLE_ENTITY]: { type: ERROR_TYPES.VALIDATION_ERROR, code: ERROR_CODES.VALIDATION_ERROR },
    [HttpStatus.TOO_MANY_REQUESTS]: { type: ERROR_TYPES.THROTTLE, code: ERROR_CODES.RATE_LIMIT_EXCEEDED },
    [HttpStatus.SERVICE_UNAVAILABLE]: { type: ERROR_TYPES.SERVICE_UNAVAILABLE, code: ERROR_CODES.SERVICE_UNAVAILABLE }
}

/**
 * An `http-errors` error meant for the client: a 4xx status and `expose: true`
 * (http-errors sets it for 4xx only, so its message is safe to return).
 */
function isClientHttpError(exception: unknown): exception is Error & { status: number } {
    if (!(exception instanceof Error) || exception instanceof HttpException) return false
    const { status, expose } = exception as Error & { status?: unknown; expose?: unknown }
    return typeof status === 'number' && status >= 400 && status < 500 && expose === true
}

/**
 * The status for one of multer's own errors (`MulterError`), matched by code.
 * Nest converts them into HttpExceptions by comparing message texts, and
 * multer 2.4 changed one ('Unexpected field' became 'Unexpected file field'),
 * so a file sent under the wrong field name reached this filter as a plain
 * error and answered 500.
 */
function multerStatus(exception: unknown): number | undefined {
    if (!(exception instanceof Error) || exception.name !== 'MulterError') return undefined
    const { code } = exception as Error & { code?: unknown }
    if (typeof code !== 'string') return undefined
    return code === 'LIMIT_FILE_SIZE' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST
}

/** The message of an error's `cause`, if it has one. */
function describeCause(exception: unknown): string | undefined {
    const cause = exception instanceof Error ? (exception as Error & { cause?: unknown }).cause : undefined
    if (cause === undefined) return undefined
    return cause instanceof Error ? cause.message || cause.name : String(cause)
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    /**
     * Whether to include internal error detail (message, stack) in responses.
     * Resolved once at construction rather than at module load so it is
     * explicit, and so tests can build a filter for either mode.
     */
    private readonly isDevelopment = process.env.NODE_ENV !== 'production'

    constructor(private readonly logger: PinoLogger) {}

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp()
        const response = ctx.getResponse<Response>()
        const request = ctx.getRequest<ExtendedRequest>()

        // Default to 500, not 400. An unhandled TypeError or a dropped database
        // connection is a server fault: reporting it as 400 tells clients not to
        // retry, and leaves http_requests_total{status_code="5xx"} at zero while
        // the application is broken — so alerting never fires.
        let status = HttpStatus.INTERNAL_SERVER_ERROR
        let message: string | string[] = 'Internal server error'
        let errors: unknown = null
        const multer = multerStatus(exception)

        if (exception instanceof HttpException) {
            status = exception.getStatus()
            const exceptionResponse = exception.getResponse()

            if (typeof exceptionResponse === 'object') {
                const httpExceptionResponse = exceptionResponse as HttpExceptionResponse
                message = httpExceptionResponse.message || exception.message
                // Keep the payload of exceptions that carry structured detail
                // but do not use this app's { code, type, errors } shape —
                // terminus' health results are the motivating case: without
                // this, a 503 said only "Service Unavailable Exception" and
                // dropped the per-indicator breakdown that makes the endpoint
                // useful.
                errors =
                    httpExceptionResponse.errors ??
                    (!('code' in httpExceptionResponse) ? (exceptionResponse as unknown) : null)
            } else {
                message = exceptionResponse as string
            }
        } else if (isClientHttpError(exception)) {
            // body-parser (oversized JSON, bad charset, malformed body) throws
            // `http-errors` objects, not HttpExceptions. Without this branch a
            // 100 KB+ JSON body answered 500 and was counted as a server fault.
            status = exception.status
            message = exception.message
        } else if (multer !== undefined) {
            const { message: text, field } = exception as Error & { field?: unknown }
            status = multer
            message = typeof field === 'string' ? `${text} - ${field}` : text
        } else if (exception instanceof Error) {
            // Logged in full below; only the generic message goes on the wire
            // outside development.
            message = this.isDevelopment ? exception.message : 'Internal server error'
        }

        // Calculate request duration
        const startTime = request.startTime
        const duration = startTime ? Date.now() - startTime : undefined

        // Metrics are not recorded here: HttpMetricsMiddleware counts every
        // response, this one included, when it finishes.

        // Structured logging. 4xx is the client's mistake (a missing token, a
        // failed validation) and logs at warn; only 5xx is a server fault at
        // error. Logging every 401 as an error buried real failures and made
        // error-level alerting useless.
        const log = status >= 500 ? this.logger.error.bind(this.logger) : this.logger.warn.bind(this.logger)
        // The message goes in the object: nestjs-pino reads a trailing string
        // as the context.
        log(
            {
                msg: 'Exception caught',
                method: request.method,
                url: redactUrl(request.url),
                statusCode: status,
                duration,
                requestId: request.requestId,
                error: {
                    message: Array.isArray(message) ? message.join('; ') : message,
                    // A 4xx's stack only shows where the app refused the
                    // request (the guard, the validation pipe): a dozen lines
                    // of noise on every expired token.
                    stack: status >= 500 && exception instanceof Error ? exception.stack : undefined,
                    // The reason underneath a 5xx whose message is kept
                    // general for the answer (CustomException's `cause`).
                    cause: status >= 500 ? describeCause(exception) : undefined,
                    // What a 5xx carries beyond its message, such as the
                    // health check's result per dependency.
                    details: status >= 500 && errors ? errors : undefined
                }
            },
            LOG_CONTEXT_HTTP
        )

        // Error tracking gets server faults only. (DomainExceptionFilter maps
        // every domain error to a 4xx, so this is the one place a request
        // fault is reported.) Not 503: the app answers it on purpose when a
        // dependency is down or it is at capacity (health check, image
        // queue), and the alerts already cover those causes.
        if (status >= 500 && status !== HttpStatus.SERVICE_UNAVAILABLE) {
            // Set by the auth guard; absent on public routes and when the
            // failure happened before authentication. The user's id: the
            // frontend reports the same id, so one person's issues match
            // across both projects.
            const { user } = request as ExtendedRequest & { user?: { id?: string } }
            reportError(exception, {
                requestId: request.requestId,
                userId: user?.id,
                method: request.method,
                route: (request.route as { path?: string } | undefined)?.path,
                statusCode: status,
                extra: errors ? { details: errors } : undefined
            })
        }

        // Prefer error code/type from exception response if present
        let errorType: string = ERROR_TYPES.GENERIC
        let errorCode: string = ERROR_CODES.GENERIC
        if (isClientHttpError(exception)) {
            errorType = STATUS_ERROR_MAP[status]?.type ?? ERROR_TYPES.BAD_REQUEST
            errorCode = STATUS_ERROR_MAP[status]?.code ?? ERROR_CODES.BAD_REQUEST
        }
        if (exception instanceof HttpException) {
            // Derive from the status rather than assuming 400 — a bare
            // NotFoundException or terminus' 503 must not be reported as a
            // client validation error.
            const derived = STATUS_ERROR_MAP[status]
            errorType = derived?.type ?? errorType
            errorCode = derived?.code ?? errorCode

            const exceptionResponse = exception.getResponse()
            if (typeof exceptionResponse === 'object') {
                const httpExceptionResponse = exceptionResponse as HttpExceptionResponse
                errorType = httpExceptionResponse.type || errorType
                errorCode = httpExceptionResponse.code || errorCode
            }

            // Check for throttle exception
            if (status === HttpStatus.TOO_MANY_REQUESTS) {
                errorType = ERROR_TYPES.THROTTLE
                errorCode = ERROR_CODES.RATE_LIMIT_EXCEEDED
                // The throttler names its header after itself
                // (Retry-After-relaxed), which CORS does not expose to the web
                // app: the standard one is what clients read.
                const wait = response.getHeader(`Retry-After-${THROTTLER_NAME}`)
                if (wait !== undefined) response.setHeader('Retry-After', wait)
            }
        }

        // Send response
        const errorResponse = {
            meta: {
                code: errorCode,
                type: errorType,
                message: Array.isArray(message) ? message.join('; ') : message,
                timestamp: new Date().toISOString(),
                request_id: request.requestId,
                request_duration: duration
            },
            data: {
                details: errors || message,
                path: redactUrl(request.url),
                method: request.method,
                // Stack traces disclose absolute paths, dependency internals and
                // module layout. Development only — the full stack is always in
                // the structured log above.
                stack: this.isDevelopment && exception instanceof Error ? exception.stack : undefined
            }
        }

        response.status(status).json(errorResponse)
    }
}
