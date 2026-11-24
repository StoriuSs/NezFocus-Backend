/**
 * What other modules may use from messaging: the clean-up of files no
 * message holds, which src/maintenance schedules; the reminder of a task
 * due soon, which the tasks module sends through the bus (REQ-TASK-04); a
 * study session started or ended, which the study module sends (D-222); a
 * call over, which the social module sends (D-242). The
 * system messages servers asks for (SYSTEM_MESSAGES) come with the join
 * message. Social answers DM_ACCESS (D-238) and reads the last message of
 * each conversation (LAST_MESSAGES, D-244). MessagingModule itself is
 * imported from './messaging.module'.
 */
export { CleanUpAttachmentsCommand } from './application/commands/attachment/attachment.commands'
export {
    PostCallEndedCommand,
    PostStudySessionCommand,
    PostTaskDueCommand
} from './application/commands/system-message/system-message.commands'
export type { CallEndedNotice, StudySessionNotice, TaskDueData } from './domain'
export { DM_ACCESS, type DmAccessPort, type DmConversation } from './application/ports/dm-access.port'
export {
    LAST_MESSAGES,
    type LastMessage,
    type LastMessagePerson,
    type LastMessagesPort
} from './application/ports/last-messages.port'
