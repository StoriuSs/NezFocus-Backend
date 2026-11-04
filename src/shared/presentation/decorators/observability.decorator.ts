import { SetMetadata } from '@nestjs/common'

export const EXCLUDE_FROM_METRICS_KEY = 'excludeFromMetrics'
export const SKIP_SUCCESS_LOG_KEY = 'skipSuccessLog'

/**
 * Keep a route out of the HTTP request metrics.
 *
 * For operational endpoints whose traffic is machine-generated: a Prometheus
 * scrape observing itself, or a Docker healthcheck every 30s, would inflate
 * the request counters and pull latency percentiles toward trivial handlers.
 *
 * Declared on the route rather than matched against the URL, so it survives a
 * change of global prefix, version, letter case or trailing slash.
 */
export const ExcludeFromMetrics = () => SetMetadata(EXCLUDE_FROM_METRICS_KEY, true)

/**
 * Don't write a log line for a successful response on this route. Failures
 * are still logged by the exception filter, so a failing healthcheck stays
 * visible while the steady-state probes stay quiet.
 */
export const SkipSuccessLog = () => SetMetadata(SKIP_SUCCESS_LOG_KEY, true)
