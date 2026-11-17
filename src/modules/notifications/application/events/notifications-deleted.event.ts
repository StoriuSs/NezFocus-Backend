import { RemovedEntry } from '../services/inbox'

/** Items taken off (REQ-NOTIF-03, D-188), by person; a new unread count for those who lost an unread one. */
export class NotificationsDeletedEvent {
    constructor(readonly entries: RemovedEntry[]) {}
}
