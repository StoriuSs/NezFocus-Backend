/*
 * Blocks (REQ-SOCIAL-03, D-237): one way, each person's own.
 */

/** Block someone (`PUT /me/blocks/{user_id}`): the friendship or request between us goes. */
export class BlockUserCommand {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}

/** Unblock them (`DELETE /me/blocks/{user_id}`): strangers again. */
export class UnblockUserCommand {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}
