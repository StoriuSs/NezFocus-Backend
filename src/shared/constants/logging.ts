/**
 * The `context` of request logs: completed requests and the exception
 * filters. Dashboards and log searches group errors by context
 * (`{service="app"} | json | context="HTTP"`).
 */
export const LOG_CONTEXT_HTTP = 'HTTP'
