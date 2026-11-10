/*
 * Reading the bans of a server (REQ-ROLE-04, S-SET-04), for BAN_MEMBERS.
 */

/** The ban list (BAN_MEMBERS), newest first. */
export class ListBansQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly page: number,
        public readonly limit: number
    ) {}
}
