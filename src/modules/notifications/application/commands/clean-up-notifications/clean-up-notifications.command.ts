/** Delete the inbox items older than 90 days (REQ-NOTIF-03), run once a day by src/maintenance. */
export class CleanUpNotificationsCommand {
    constructor(readonly now: Date) {}
}
