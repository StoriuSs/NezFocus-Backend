/*
 * Friend requests and friendships (REQ-SOCIAL-01, D-237): each names the
 * person by id but the first, which names them by username.
 */

/** Ask someone by username, with an optional note (`POST /me/relationships`); theirs waiting → friends. */
export class RequestFriendByUsernameCommand {
    constructor(
        readonly userId: string,
        readonly username: string,
        readonly note: string | null
    ) {}
}

/** Ask someone from their profile, no note (`PUT /me/relationships/{user_id}`); asking again changes nothing. */
export class RequestFriendCommand {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}

/** Accept their request (`POST /me/relationships/{user_id}/accept`). */
export class AcceptFriendRequestCommand {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}

/** Decline their request, cancel mine, or unfriend (`DELETE /me/relationships/{user_id}`). */
export class RemoveRelationshipCommand {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}
