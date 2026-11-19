/**
 * Where the person stands in every channel they may view, voice rooms' chat
 * too (REQ-MSG-09, SRS 5.1): read when the app opens.
 */
export class ListReadStatesQuery {
    constructor(readonly userId: string) {}
}
