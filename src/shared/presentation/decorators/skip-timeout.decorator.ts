import { SetMetadata } from '@nestjs/common'

export const SKIP_TIMEOUT_KEY = 'skipTimeout'

/**
 * Exempt a route from REQUEST_TIMEOUT_MS: long-polling, streamed downloads,
 * slow exports. `@Sse()` routes are exempt automatically — a stream that went
 * 30s without an event would otherwise be cut.
 */
export const SkipTimeout = () => SetMetadata(SKIP_TIMEOUT_KEY, true)
