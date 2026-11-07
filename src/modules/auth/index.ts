/**
 * What the rest of the application may use from auth. Anything not exported
 * here is internal (an ESLint rule enforces this inside src/modules). AuthModule
 * itself is imported from './auth.module'.
 */

// The global bearer-token check, registered by AppModule after the throttler.
export { AccessTokenGuard } from './presentation/guards/access-token.guard'

// The global throttler counts signed-in requests per user (D-135), checking the
// token with the TOKEN_SERVICE that AuthModule exports.
export { throttleByUser } from './presentation/rate-limit/throttle-by-user'
export { TOKEN_SERVICE, type TokenServicePort } from './application/ports'

// Run on a schedule by src/maintenance.
export { CleanUpAuthCommand } from './application/commands/clean-up-auth/clean-up-auth.command'
