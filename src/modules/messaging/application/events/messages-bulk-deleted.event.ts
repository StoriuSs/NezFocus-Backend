/** Messages of one channel deleted together, one batch of a ban's (D-181): as each deleted alone (REQ-MSG-05). */
export class MessagesBulkDeletedEvent {
    constructor(
        readonly channelId: string,
        readonly ids: string[]
    ) {}
}
