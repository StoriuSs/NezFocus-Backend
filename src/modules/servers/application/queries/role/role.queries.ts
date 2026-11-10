import { MemberSearch } from '../../ports'

/*
 * Reading the roles and the members (REQ-ROLE-01, S-SET-02, S-SET-03, D-152).
 * Read without the server row's lock: what they show may be a moment old.
 */

/** The Roles page (MANAGE_ROLES). */
export class ListRolesQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}

/** The server's members, for anyone in it (D-152). */
export class ListMembersQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly search: MemberSearch
    ) {}
}
