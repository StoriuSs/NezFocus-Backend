import { MessageView } from '../services/message-views'

/**
 * A message was saved (REQ-MSG-01). Published once per message: a send that
 * repeats a nonce returns the saved message and publishes nothing.
 */
export class MessageCreatedEvent {
    constructor(
        readonly message: MessageView,
        /** The sender's own mark, so its tabs swap their "sending" copy for this one; null on a system message. */
        readonly nonce: string | null
    ) {}
}
