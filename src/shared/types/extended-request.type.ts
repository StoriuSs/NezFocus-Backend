import { Request } from 'express'

/**
 * Extended Express Request with custom properties added by middleware
 * Used for tracking request ID and timing across the application
 */
export interface ExtendedRequest extends Request {
    requestId?: string
    startTime?: number
    /** Set by RequestContextGuard from `@ExcludeFromMetrics()`. */
    excludeFromMetrics?: boolean
}
