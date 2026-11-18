/**
 * Set the rows right against LiveKit (D-210): run every minute by
 * src/maintenance, and once as the API starts.
 */
export class ReconcileVoiceRoomsCommand {
    constructor(public readonly now: Date) {}
}
