/** Sell a realtime ticket to a signed-in session (POST /realtime/ticket). */
export class IssueTicketCommand {
    constructor(
        public readonly userId: string,
        public readonly sessionId: string
    ) {}
}
