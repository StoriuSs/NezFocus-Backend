import { FriendItemType } from '../../../domain'

/*
 * The items of friend requests (REQ-SOCIAL-01, NOTIF-03, D-111, D-242):
 * written for the people the social module names after its own write,
 * through NOTIFIER. They belong to no server.
 */

/** Give this person a friend item from `actorId`: a request (with its note) or a request of theirs accepted. */
export class AddFriendItemCommand {
    constructor(
        readonly type: FriendItemType,
        readonly userId: string,
        readonly actorId: string,
        readonly note: string | null
    ) {}
}

/** A request between these two answered, cancelled or ended by a block: its item goes, whichever way it was sent. */
export class RemoveFriendRequestItemsCommand {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}
