import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { EXCLUDE_FROM_METRICS_KEY } from '@/shared/presentation/decorators/observability.decorator'
import { ExtendedRequest } from '@/shared/types'

/**
 * Copies route metadata onto the request for code that runs outside Nest's
 * execution context. Never blocks.
 *
 * HttpMetricsMiddleware records a request when the response finishes, where
 * there is no handler to reflect on. This guard is registered first, so the
 * flag is set before any other guard can reject the request — a 429 or 401 on
 * an excluded route stays excluded too.
 */
@Injectable()
export class RequestContextGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        if (context.getType() !== 'http') return true

        const request = context.switchToHttp().getRequest<ExtendedRequest>()
        request.excludeFromMetrics = this.reflector.getAllAndOverride<boolean>(EXCLUDE_FROM_METRICS_KEY, [
            context.getHandler(),
            context.getClass()
        ])
        return true
    }
}
