import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
    BadRequestException,
    ConflictException,
    HttpStatus
} from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { ConfigService } from '@nestjs/config'
import { Observable } from 'rxjs'
import { Reflector } from '@nestjs/core'
import { createHash } from 'crypto'
import {
    IdempotencyClaim,
    IdempotencyService,
    IdempotencyScope
} from '@/shared/infrastructure/idempotency/idempotency.service'
import { IDEMPOTENT_KEY } from '@/shared/presentation/decorators/idempotent.decorator'
import { CustomException } from '@/shared/presentation/exceptions/custom.exception'
import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants'
import { calculateTTLInSeconds } from '@/shared/utils/time.util'
import { createResponse, ServiceResponse } from '@/shared/types/service-response.type'
import { REPEATED_ERROR_LOG_INTERVAL_MS, throttledLog } from '@/shared/utils/log-throttle.util'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A claim outlives the request timeout by this much before it may expire. */
const LEASE_MARGIN_MS = 30_000

interface HttpRequestLike {
    headers: Record<string, string | string[] | undefined>
    method: string
    url: string
    body?: unknown
    route?: { path?: string }
    user?: { id?: string }
    is?: (type: string) => string | false | null
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    private readonly logger = new Logger(IdempotencyInterceptor.name)
    private readonly logStoreFailure = throttledLog(
        (message) => this.logger.error(message),
        REPEATED_ERROR_LOG_INTERVAL_MS
    )
    private readonly leaseMs: number

    constructor(
        private readonly reflector: Reflector,
        private readonly idempotencyService: IdempotencyService,
        configService: ConfigService
    ) {
        const requestTimeoutMs = configService.get<number>('timeout.requestTimeout') ?? 30_000
        this.leaseMs = requestTimeoutMs + LEASE_MARGIN_MS
    }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        const request = context.switchToHttp().getRequest<HttpRequestLike>()
        const response = context.switchToHttp().getResponse()

        const ttl = this.reflector.get<string>(IDEMPOTENT_KEY, context.getHandler())
        if (!ttl) {
            return next.handle()
        }

        const idempotencyKey = request.headers['idempotency-key']

        if (!idempotencyKey) {
            throw new BadRequestException('Idempotency-Key header is required for this endpoint')
        }

        // A bounded, well-formed value keeps a hostile header from shaping the
        // key space.
        if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey)) {
            throw new BadRequestException('Idempotency-Key header must be a valid UUID')
        }

        // Bind the key to the caller and the route. Keying on the raw
        // client-supplied value alone lets one user replay another user's
        // cached response by reusing their key.
        const scope: IdempotencyScope = {
            key: idempotencyKey,
            userId: request.user?.id ?? 'anonymous',
            method: request.method,
            route: request.route?.path ?? request.url
        }
        const ttlMs = calculateTTLInSeconds(ttl) * 1000
        const fingerprint = this.fingerprint(request)

        const cached = await this.idempotencyService.getResponse(scope)
        if (cached) {
            this.assertSameRequest(cached.fingerprint, fingerprint)

            if (cached.status === 'PROCESSING') {
                throw this.inProgress()
            }

            // COMPLETED — replay the stored response
            response.status(cached.statusCode)
            const body = cached.envelope ? this.rebrand(cached.body) : cached.body
            return new Observable((subscriber) => {
                subscriber.next(body)
                subscriber.complete()
            })
        }

        const claim = await this.idempotencyService.acquireLock(scope, this.leaseMs, fingerprint)
        if (claim === null) {
            // Claimed by a concurrent request between our read and this call
            throw this.inProgress()
        }

        return this.executeOnce(next.handle(), scope, claim, ttlMs, fingerprint, this.successStatus(context, request))
    }

    /**
     * Runs the handler and records how it settled — even if this request's own
     * stream is torn down first.
     *
     * TimeoutInterceptor (outside this one) and a client disconnect unsubscribe
     * from the stream; neither stops the handler, whose work carries on. The
     * lock used to be released on that unsubscribe, so a client retrying after
     * a 408 ran the operation a second time while the first was still going —
     * the duplicate idempotency exists to prevent. The inner subscription is
     * therefore kept alive until the handler settles: success stores the
     * response (retries replay it), failure releases the claim (retries run
     * fresh), and until then retries get 409.
     */
    private executeOnce(
        source: Observable<unknown>,
        scope: IdempotencyScope,
        claim: IdempotencyClaim,
        ttlMs: number,
        fingerprint: string | undefined,
        statusCode: number
    ): Observable<unknown> {
        return new Observable((subscriber) => {
            // The claim is renewed until the handler settles, however long
            // that takes; its lease only ends it when this process is gone.
            const renewal = setInterval(
                () => void this.idempotencyService.renewLock(scope, claim, this.leaseMs),
                Math.max(1000, Math.floor(this.leaseMs / 3))
            )
            renewal.unref()
            const settled = () => clearInterval(renewal)
            source.subscribe({
                next: (data) => {
                    settled()
                    this.idempotencyService
                        .cacheResponse(scope, data, statusCode, ttlMs, fingerprint)
                        .catch((error: Error) => {
                            // The response was not stored, so a retry can't be
                            // answered from it. Free the key for a fresh run
                            // rather than leaving retries on 409 until the
                            // lease runs out.
                            this.logStoreFailure(`Failed to store idempotent response: ${error.message}`)
                            void this.idempotencyService.releaseLock(scope, claim)
                        })
                    subscriber.next(data)
                },
                error: (error) => {
                    settled()
                    void this.idempotencyService.releaseLock(scope, claim)
                    subscriber.error(error)
                },
                complete: () => {
                    settled()
                    subscriber.complete()
                }
            })
            // No teardown on purpose: see above.
        })
    }

    /**
     * The status Nest will send for this route's success: its @HttpCode, else
     * 201 for POST and 200 otherwise. Not `response.statusCode` — Nest applies
     * the route status after interceptors, and after a timeout the response
     * already holds 408, which the replay would then repeat.
     */
    private successStatus(context: ExecutionContext, request: HttpRequestLike): number {
        const declared = this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler())
        return declared ?? (request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK)
    }

    /**
     * A hash of the request body, when it is available here. Global
     * interceptors run before route interceptors, so a multipart body (parsed
     * by the route's FileInterceptor) is not readable yet and gets none.
     */
    private fingerprint(request: HttpRequestLike): string | undefined {
        if (!request.is?.('application/json') || request.body === undefined) return undefined
        return createHash('sha256').update(JSON.stringify(request.body)).digest('hex')
    }

    private assertSameRequest(stored: string | undefined, current: string | undefined): void {
        if (stored && current && stored !== current) {
            throw new CustomException({
                code: ERROR_CODES.IDEMPOTENCY_KEY_MISMATCH,
                type: ERROR_TYPES.IDEMPOTENCY_KEY_MISMATCH,
                message: 'This Idempotency-Key was already used with a different request body.',
                status: HttpStatus.UNPROCESSABLE_ENTITY
            })
        }
    }

    private inProgress(): ConflictException {
        return new ConflictException(
            'A request with this Idempotency-Key is already being processed. Please retry shortly.'
        )
    }

    /**
     * Restore the ServiceResponse brand on a replayed body, so
     * TransformInterceptor builds the same { meta, data } envelope as it did
     * for the original response.
     */
    private rebrand(body: unknown): unknown {
        const { message, data } = body as ServiceResponse
        return createResponse(message, data)
    }
}
