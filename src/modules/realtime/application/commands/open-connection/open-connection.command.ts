/** A socket asks to connect with the ticket it was sold (ARCHITECTURE 3.1). */
export class OpenConnectionCommand {
    constructor(public readonly ticket: string) {}
}
