import { NextFunction, Response } from 'express'
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { ExtendedRequest } from '@/shared/types'

/** Path label for requests that matched no route. */
export const UNMATCHED_ROUTE = 'unmatched'

/**
 * The single recorder for HTTP request metrics.
 *
 * It hooks the response rather than the handler, so every response is counted
 * exactly once whoever produced it: a handler, a guard rejection, the global
 * or a module's exception filter, a body-parser error, or Nest's 404.
 * Recording used to be split between an interceptor (successes) and the global
 * filter (failures), and a module's own exception filter fell between the two.
 *
 * The path label is the matched route template (`/api/v1/users/:id`), never
 * the raw URL. A request that matched no route is labelled `unmatched`: with
 * the raw URL, every random path or query string a scanner sent created new
 * time series, growing memory and the /metrics payload without bound.
 *
 * Register it with `app.use()` in main.ts, not through MiddlewareConsumer:
 * Nest prefixes consumer routes with the global prefix, so requests outside
 * `/api` — exactly the scanner traffic above — would never be counted.
 */
export function httpMetricsMiddleware(metrics: MetricsService) {
    return (req: ExtendedRequest, res: Response, next: NextFunction) => {
        const start = process.hrtime.bigint()
        metrics.incrementActiveRequests()

        res.once('finish', () => {
            if (req.excludeFromMetrics) return
            const durationMs = Number(process.hrtime.bigint() - start) / 1e6
            const path = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : UNMATCHED_ROUTE
            metrics.recordRequest(req.method, path, res.statusCode, durationMs)
        })

        // 'close' follows 'finish' on a completed response, and also fires
        // alone when the client disconnects first — so the gauge always comes
        // back down. The request itself is only counted if a response was sent.
        res.once('close', () => metrics.decrementActiveRequests())

        next()
    }
}
