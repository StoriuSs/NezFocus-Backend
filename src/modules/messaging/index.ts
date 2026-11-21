/**
 * What other modules may use from messaging: the clean-up of files no
 * message holds, which src/maintenance schedules; the reminder of a task
 * due soon, which the tasks module sends through the bus (REQ-TASK-04); a
 * study session started or ended, which the study module sends (D-222). The
 * system messages servers asks for (SYSTEM_MESSAGES) come with the join
 * message. MessagingModule itself is imported from './messaging.module'.
 */
export { CleanUpAttachmentsCommand } from './application/commands/attachment/attachment.commands'
export {
    PostStudySessionCommand,
    PostTaskDueCommand
} from './application/commands/system-message/system-message.commands'
export type { StudySessionNotice, TaskDueData } from './domain'
