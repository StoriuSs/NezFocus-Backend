/** A page of one's inbox, newest first, older than `beforeId` (or the newest) (SRS 5.1). */
export class ListNotificationsQuery {
    constructor(
        readonly userId: string,
        readonly beforeId: string | null,
        readonly limit: number
    ) {}
}
