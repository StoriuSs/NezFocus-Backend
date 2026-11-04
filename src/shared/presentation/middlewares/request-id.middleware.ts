import { randomUUID } from 'crypto'
import { Response, NextFunction } from 'express'
import { ExtendedRequest } from '@/shared/types'

/** Correlation ids are echoed and logged, so only accept a known-safe shape. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Assigns every request a correlation id and a start time.
 *
 * Registered with `app.use()` in main.ts rather than MiddlewareConsumer, which
 * applies the global prefix: requests outside `/api` got no id, so their error
 * envelopes and log lines carried `request_id: undefined`.
 */
export function requestIdMiddleware(req: ExtendedRequest, res: Response, next: NextFunction) {
    // Honour a client-supplied correlation id, but only if it is a
    // well-formed UUID.
    //
    // The value is reflected in a response header and written into every
    // log line and error envelope. Accepting it unvalidated let a caller
    // inject arbitrary length or content into log aggregation, forge trace
    // ids across tenants, and — with characters illegal in a header value —
    // make res.setHeader throw from inside middleware.
    const incoming = req.headers['x-request-id']
    const requestId = typeof incoming === 'string' && UUID_PATTERN.test(incoming) ? incoming : randomUUID()

    req.requestId = requestId
    req.startTime = Date.now()

    // Also attach it to response header for easier debugging
    res.setHeader('x-request-id', requestId)

    next()
}
