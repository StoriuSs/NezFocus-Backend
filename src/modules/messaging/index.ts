/**
 * What other modules may use from messaging: the clean-up of files no
 * message holds, which src/maintenance schedules. The system messages
 * servers asks for (SYSTEM_MESSAGES) come with the join message.
 * MessagingModule itself is imported from './messaging.module'.
 */
export { CleanUpAttachmentsCommand } from './application/commands/attachment/attachment.commands'
