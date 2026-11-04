import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { Logger } from 'nestjs-pino'
import { ExtendedRequest } from '@/shared/types'
import { LOG_CONTEXT_HTTP } from '@/shared/constants'
import { redactUrl } from '@/shared/constants/sensitive-fields'
import { SKIP_SUCCESS_LOG_KEY } from '@/shared/presentation/decorators/observability.decorator'

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    constructor(
        private readonly logger: Logger,
        private readonly reflector: Reflector
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        // Routes marked @SkipSuccessLog() — Prometheus scrapes, Docker
        // healthchecks every 30s — would otherwise be thousands of lines a day
        // of pure noise. Their failures are still logged by the exception
        // filter, so a failing healthcheck stays visible.
        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SUCCESS_LOG_KEY, [
            context.getHandler(),
            context.getClass()
        ])
        if (skip) {
            return next.handle()
        }

        const ctx = context.switchToHttp()
        const request = ctx.getRequest<ExtendedRequest>()
        const { method } = request
        // Google's return carries a one-time code and the state in its query.
        const url = redactUrl(request.url)
        const requestId = request.requestId
        const startTime = request.startTime || Date.now()

        return next.handle().pipe(
            tap({
                next: () => {
                    const response = ctx.getResponse()
                    // nestjs-pino reads a trailing string as the context, not
                    // the message: the message goes in the object.
                    this.logger.log(
                        {
                            msg: 'Request completed',
                            method,
                            url,
                            statusCode: response.statusCode,
                            duration: Date.now() - startTime,
                            requestId
                        },
                        LOG_CONTEXT_HTTP
                    )
                }
            })
        )
    }
}
