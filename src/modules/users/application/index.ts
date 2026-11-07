// Export all ports
export * from './ports'

// Export all commands
export * from './commands/update-profile/update-profile.command'
export * from './commands/update-profile/update-profile.handler'
export * from './commands/upload-avatar/upload-avatar.command'
export * from './commands/upload-avatar/upload-avatar.handler'
export * from './commands/remove-avatar/remove-avatar.command'
export * from './commands/remove-avatar/remove-avatar.handler'
export * from './commands/delete-account/delete-account.command'
export * from './commands/delete-account/delete-account.handler'
export * from './commands/sweep-deleted-accounts/sweep-deleted-accounts.command'
export * from './commands/sweep-deleted-accounts/sweep-deleted-accounts.handler'

// Export all queries
export * from './queries/check-username/check-username.query'
export * from './queries/check-username/check-username.handler'
export * from './queries/resolve-avatar-url/resolve-avatar-url.query'
export * from './queries/resolve-avatar-url/resolve-avatar-url.handler'

// Export all events
export * from './events/account-deleted.event'
export * from './events/avatar-uploaded.event'
export * from './events/avatar-removed.event'
export * from './events/user-profile-updated.event'

// Export all event handlers
export * from './events/handlers/cleanup-old-avatar.handler'
export * from './events/handlers/cleanup-account-avatar.handler'
