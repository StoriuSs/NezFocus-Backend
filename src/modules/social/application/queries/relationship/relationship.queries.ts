/*
 * Reads of friends and blocks (REQ-SOCIAL-02, D-237, D-242): a person's own
 * list and one person in it, and what other modules ask through ports
 * answered here (realtime's FRIENDS, notifications' BLOCK_LIST).
 */

/** Everyone in my list, once, as the client keeps it (`GET /me/relationships`, D-242: no pages). */
export class ListMyRelationshipsQuery {
    constructor(readonly userId: string) {}
}

/** One person as I see them now, for the answer to a change (D-237, D-159); null when the account is gone. */
export class GetRelationshipQuery {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}

/** The ids of a person's friends, whom their presence goes to (D-242). */
export class ListFriendIdsQuery {
    constructor(readonly userId: string) {}
}

/** Whom a person blocked: their inbox hides those people's items (REQ-NOTIF-03, D-242). */
export class ListBlockedIdsQuery {
    constructor(readonly userId: string) {}
}

/** Those of `userIds` who blocked `blockedId`: no inbox item for them from that person (D-185, D-242). */
export class ListBlockersAmongQuery {
    constructor(
        readonly blockedId: string,
        readonly userIds: string[]
    ) {}
}
