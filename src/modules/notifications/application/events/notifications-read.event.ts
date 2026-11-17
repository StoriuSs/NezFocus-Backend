/**
 * Someone's items marked read (REQ-NOTIF-02): those of `ids`, or every one up
 * to `beforeId`; with their unread count now.
 */
export class NotificationsReadEvent {
    constructor(
        readonly userId: string,
        readonly ids: string[] | null,
        readonly beforeId: string | null,
        readonly unreadCount: number
    ) {}
}
