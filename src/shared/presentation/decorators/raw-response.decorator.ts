import { SetMetadata } from '@nestjs/common'

/**
 * Key used to identify routes that should skip response transformation.
 * These routes return raw responses without the standard API wrapper.
 */
export const RAW_RESPONSE_KEY = 'raw_response'

/**
 * Decorator to skip the TransformInterceptor for specific endpoints.
 * Use this when you need to return raw data (e.g., Prometheus metrics, file downloads, etc.)
 *
 * @example
 * ```typescript
 * @RawResponse()
 * @Get('export')
 * exportCsv() {
 *   return 'name,email\nJohn,john@example.com'
 * }
 * ```
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true)
