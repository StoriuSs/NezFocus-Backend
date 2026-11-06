/**
 * What other modules may use from users. Anything not exported here is
 * internal: import it from inside the module only (an ESLint rule enforces
 * this). UsersModule itself is imported from './users.module'.
 */

// The port other modules read user records through.
export {
    AccountCompletionInput,
    DirectoryUser,
    UserDirectoryPort,
    USER_DIRECTORY
} from './application/ports/user-directory.port'

// What UserDirectoryPort.complete throws when the username is taken.
export { UsernameTakenError } from './domain/errors/username.errors'

// Events other modules may react to.
export { AccountDeletedEvent } from './application/events/account-deleted.event'
export { UserProfileUpdatedEvent } from './application/events/user-profile-updated.event'

// Commands other modules may send: auth sends this one once the owner has proved it is them.
export { DeleteAccountCommand } from './application/commands/delete-account/delete-account.command'
// Run on a schedule by src/maintenance.
export { SweepDeletedAccountsCommand } from './application/commands/sweep-deleted-accounts/sweep-deleted-accounts.command'

// How addresses are compared, for anything that looks an account up by one.
export { normaliseEmail } from './domain/email.rules'
// What a username and a time zone may be, for the "complete your account" step.
export { USERNAME_PATTERN, normaliseUsername } from './domain/username.rules'
export { canonicalTimeZone } from './domain/timezone.rules'
