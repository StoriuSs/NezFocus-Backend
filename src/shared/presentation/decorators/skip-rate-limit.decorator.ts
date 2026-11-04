import { SkipThrottle } from '@nestjs/throttler'

/**
 * Name of the app's single throttler. It is part of every rate-limit key in
 * Redis, and `@SkipThrottle()` only skips throttlers it names — its default
 * argument is `{ default: true }`, which silently skips nothing here.
 */
export const THROTTLER_NAME = 'relaxed'

/** Exempt a route (or controller) from the global rate limit. */
export const SkipRateLimit = () => SkipThrottle({ [THROTTLER_NAME]: true })
