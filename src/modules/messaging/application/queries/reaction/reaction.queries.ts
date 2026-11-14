/** Who gave an emoji to a message, for its tooltip (SRS 1.71). */
export class ListReactorsQuery {
    constructor(
        readonly userId: string,
        readonly messageId: string,
        readonly emoji: string
    ) {}
}
