import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { instanceToPlain } from 'class-transformer'
import { toSnakeCaseKeys } from '@/shared/utils/case-keys.util'
import { ExtendedRequest, isServiceResponse } from '@/shared/types'
import { RAW_RESPONSE_KEY } from '@/shared/presentation/decorators'

/**
 * A success. Errors (GlobalExceptionFilter) add `code` and `type` to `meta`;
 * a success has neither, because the route and the status already say what
 * happened.
 */
export interface ApiResponse<T = unknown> {
    meta: {
        message: string
        timestamp: string
        request_id?: string
        request_duration?: number
    }
    data: T
}

export { ApiResponse as ApiResponseInterface }

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
        const ctx = context.switchToHttp()
        const request = ctx.getRequest<ExtendedRequest>()

        // Check for @RawResponse() decorator
        const isRawResponse = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
            context.getHandler(),
            context.getClass()
        ])

        // Skip transformation for @RawResponse() routes (e.g. the metrics endpoint)
        if (isRawResponse) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return next.handle() as any
        }

        return next.handle().pipe(
            map((data) => {
                // Decide what this payload IS before any transformation — the
                // brand is non-enumerable and does not survive instanceToPlain
                // or the key conversion.
                const isEnvelope = isServiceResponse(data)

                // Transform class instances to plain objects with proper serialization
                let transformedData = data
                if (data && typeof data === 'object') {
                    transformedData = instanceToPlain(data)
                }

                // Convert to snake_case (arrays and primitives included)
                transformedData = toSnakeCaseKeys(transformedData) as typeof transformedData

                // Get request duration calculated by middleware
                const startTime = request.startTime
                const requestDuration = startTime ? Date.now() - startTime : undefined

                // A response built by createResponse — identified by its brand,
                // not by guessing from the presence of keys that ordinary
                // payload data may legitimately contain.
                if (isEnvelope && transformedData && typeof transformedData === 'object') {
                    return {
                        meta: {
                            message: transformedData.message || 'Success',
                            timestamp: new Date().toISOString(),
                            request_id: request.requestId,
                            request_duration: requestDuration
                        },
                        data: transformedData.data !== undefined ? transformedData.data : null
                    }
                }

                // Anything else is the payload itself. It is wrapped verbatim:
                // previously a top-level `message` field was promoted into the
                // envelope and a top-level `data` field replaced the whole
                // body, so a resource that happened to have either key was
                // silently mangled.
                return {
                    meta: {
                        message: 'Success',
                        timestamp: new Date().toISOString(),
                        request_id: request.requestId,
                        request_duration: requestDuration
                    },
                    data: transformedData ?? null
                } as ApiResponse<T>
            })
        )
    }
}
