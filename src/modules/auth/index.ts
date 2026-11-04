/**
 * What the rest of the application may use from auth. Anything not exported
 * here is internal (an ESLint rule enforces this inside src/modules). AuthModule
 * itself is imported from './auth.module'.
 */

// The global bearer-token check, registered by AppModule after the throttler.
export { AccessTokenGuard } from './presentation/guards/access-token.guard'

// Run on a schedule by src/maintenance.
export { CleanUpAuthCommand } from './application/commands/clean-up-auth/clean-up-auth.command'
