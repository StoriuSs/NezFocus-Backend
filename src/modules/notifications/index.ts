/**
 * What other modules may use from notifications: NOTIFIER, to put items in
 * people's inboxes (D-185), given by the global NotifierModule; the
 * MESSAGE_PREVIEWS port messaging answers (D-198); the clean-up src/maintenance
 * schedules. NotificationsModule itself is imported from
 * './notifications.module'.
 */
export {
    NOTIFIER,
    type MessageNotice,
    type ModerationNotice,
    type NotifierPort,
    type ServerNotice,
    type TaskNotice
} from './application/ports/notifier.port'
export {
    MESSAGE_PREVIEWS,
    type MessagePreview,
    type MessagePreviewsPort,
    type PreviewPerson
} from './application/ports/message-previews.port'
export type { MessageMentionSources, ModerationAction, TaskReminder, UnassignedBy } from './domain/notification.rules'
export { CleanUpNotificationsCommand } from './application/commands/clean-up-notifications/clean-up-notifications.command'
