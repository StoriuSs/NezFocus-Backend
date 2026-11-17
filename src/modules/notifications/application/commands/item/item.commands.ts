import { MessageNotice } from '../../ports'

/** Make a message's items match whom it mentions or answers now (D-183, D-188). */
export class SyncMessageItemsCommand {
    constructor(readonly notice: MessageNotice) {}
}

/** Take off the items of messages deleted from one channel (REQ-NOTIF-03). */
export class RemoveMessageItemsCommand {
    constructor(
        readonly channelId: string,
        readonly messageIds: string[]
    ) {}
}
