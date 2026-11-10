import { MemberSearch } from '../ports'
import { RoleEdit } from '../../domain'

/*
 * Roles and who holds them (REQ-ROLE-01, ROLE-02, S-SET-02, D-152, D-153).
 * The rules live in domain/roles.ts; each change runs in
 * RoleRepositoryPort.change, under the server row's lock.
 */

/** The Roles page (MANAGE_ROLES). */
export class ListRolesQuery {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}

export class CreateRoleCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly name: string
    ) {}
}

export class UpdateRoleCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly roleId: string,
        public readonly edit: RoleEdit
    ) {}
}

export class DeleteRoleCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly roleId: string
    ) {}
}

/** Both lists highest first, @everyone left out: the order wanted and the one seen. */
export class ReorderRolesCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly seen: string[],
        public readonly wanted: string[]
    ) {}
}

/** Give a role to several members at once, all or none (D-153). */
export class GrantRoleCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly roleId: string,
        public readonly userIds: string[]
    ) {}
}

export class RevokeRoleCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly roleId: string,
        public readonly targetId: string
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
