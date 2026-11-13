import { MessageView } from '../services/message-views'

/** A message's text was edited (REQ-MSG-05). Not published when the text did not change. */
export class MessageUpdatedEvent {
    constructor(readonly message: MessageView) {}
}
