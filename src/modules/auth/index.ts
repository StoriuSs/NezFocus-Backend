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

// The account's password checked again, for a step of another module that
// asks for it (handing a server over, D-160). AuthModule exports it.
export { CURRENT_PASSWORD, type CurrentPasswordPort } from './application/ports/current-password.port'

// What deleting an account asks of the servers module, which answers it (D-160).
export { SERVER_OWNERSHIP, type ServerOwnershipPort } from './application/ports/server-ownership.port'
export type { BlockingServer } from './domain'

// Run on a schedule by src/maintenance.
export { CleanUpAuthCommand } from './application/commands/clean-up-auth/clean-up-auth.command'
