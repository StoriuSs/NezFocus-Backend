import { applyDecorators, SetMetadata } from '@nestjs/common'
import { ApiHeader } from '@nestjs/swagger'

export const IDEMPOTENT_KEY = 'idempotent'

/**
 * Decorator to mark an endpoint as idempotent (docs/idempotency.md). Also
 * documents the `Idempotency-Key` header it requires in the OpenAPI spec, so
 * the two cannot be applied one without the other.
 * @param ttl - Time to live for cached response (e.g., '1h', '30m', '1d')
 */
export const Idempotent = (ttl: string = '24h') =>
    applyDecorators(
        SetMetadata(IDEMPOTENT_KEY, ttl),
        ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID identifying one user intent' })
    )
