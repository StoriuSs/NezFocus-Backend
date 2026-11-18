import { ServerItemDraft } from '../../../domain'

/*
 * The items a server's people get (REQ-SRV-05, REQ-ROLE-04): written for the
 * person the servers module names after its own write, through NOTIFIER.
 */

/** Give this person an owner or moderation item. */
export class AddServerItemCommand {
    constructor(
        readonly draft: ServerItemDraft,
        readonly userId: string
    ) {}
}
