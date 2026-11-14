/** Where the person stands in every text channel they may view (REQ-MSG-09, SRS 5.1): read when the app opens. */
export class ListReadStatesQuery {
    constructor(readonly userId: string) {}
}
