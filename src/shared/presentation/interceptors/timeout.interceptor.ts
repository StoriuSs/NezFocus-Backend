import { Injectable, NestInterceptor, ExecutionContext, CallHandler, RequestTimeoutException } from '@nestjs/common'
import { SSE_METADATA } from '@nestjs/common/constants'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { Observable, throwError, TimeoutError } from 'rxjs'
import { catchError, timeout } from 'rxjs/operators'
import { SKIP_TIMEOUT_KEY } from '@/shared/presentation/decorators/skip-timeout.decorator'

/**
 * Answers 408 when a handler takes longer than REQUEST_TIMEOUT_MS.
 *
 * This bounds how long a CLIENT waits; it does not cancel the work. The
 * handler's promise keeps running to completion (nothing passes it an abort
 * signal), so its side effects still happen after the 408. Idempotent routes
 * account for that — see IdempotencyInterceptor.executeOnce.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
    private readonly timeout: number

    constructor(
        private readonly configService: ConfigService,
        private readonly reflector: Reflector
    ) {
        this.timeout = this.configService.get<number>('timeout.requestTimeout')!
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const exempt =
            this.reflector.get<boolean>(SSE_METADATA, context.getHandler()) ||
            this.reflector.getAllAndOverride<boolean>(SKIP_TIMEOUT_KEY, [context.getHandler(), context.getClass()])
        if (exempt) {
            return next.handle()
        }

        return next.handle().pipe(
            timeout(this.timeout),
            catchError((err) => {
                if (err instanceof TimeoutError) {
                    return throwError(() => new RequestTimeoutException('Request timeout'))
                }
                return throwError(() => err)
            })
        )
    }
}
