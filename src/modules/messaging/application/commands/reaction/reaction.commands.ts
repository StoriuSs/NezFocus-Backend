/** Give an emoji to a message (REQ-MSG-05); giving it again changes nothing. */
export class AddReactionCommand {
    constructor(
        readonly userId: string,
        readonly messageId: string,
        /** As the route has it, checked by the handler: exactly one standard emoji. */
        readonly emoji: string
    ) {}
}

/** Take one's own emoji off a message (REQ-MSG-05); one not given changes nothing. */
export class RemoveReactionCommand {
    constructor(
        readonly userId: string,
        readonly messageId: string,
        readonly emoji: string
    ) {}
}
