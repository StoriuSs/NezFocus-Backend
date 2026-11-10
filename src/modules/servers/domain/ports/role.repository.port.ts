import { RoleState, RoleWrite } from '../roles'

/** A role as the Roles page lists it (S-SET-02), @everyone included. */
export interface RoleListItem {
    id: string
    name: string
    /** Higher is more senior; @everyone is 0. */
    position: number
    permissions: bigint
    mentionable: boolean
    isEveryone: boolean
    /** How many members hold it; for @everyone, every member. */
    memberCount: number
}

export interface RoleRepositoryPort {
    /**
     * One change to the roles (REQ-ROLE-01, ROLE-02). In one transaction:
     * lock the live server's row (the lock the channel list takes too), read
     * the server, the person acting and the members in `targetIds`, let
     * `decide` turn that into writes (or throw), and carry them out.
     *
     * Null, with nothing written, when the server is gone or they are not in
     * it. Otherwise the id of the role created, if one was.
     */
    change(
        serverId: string,
        userId: string,
        targetIds: string[],
        decide: (state: RoleState) => RoleWrite[]
    ): Promise<{ createdId: string | null } | null>

    /** Every role of the live server, highest first, @everyone last. */
    list(serverId: string): Promise<RoleListItem[]>
}

export const ROLE_REPOSITORY = Symbol('RoleRepositoryPort')
