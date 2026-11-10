import { AccessMember } from '@/modules/permissions'
import { LayoutState, LayoutWrite } from '../channel-layout'
import { ServerSnapshot } from '../member-view'
import { ServerPlan } from '../server-templates'

export interface NewServer {
    ownerId: string
    name: string
    plan: ServerPlan
    /** Refused when the owner is already in this many servers. */
    maxServers: number
}

export interface MembershipSnapshot {
    server: ServerSnapshot
    member: AccessMember
}

export interface ServerRepositoryPort {
    /**
     * The server, its @everyone and template roles, categories and channels,
     * and the owner as its first member, in one transaction. Null, with
     * nothing written, when the owner is already in `maxServers` servers:
     * counted under a lock on that person's memberships, so two creations at
     * 99 cannot both pass.
     */
    create(server: NewServer): Promise<{ serverId: string } | null>

    /** Every live server the person is in, in the order they joined (C-05), or just `serverId`. */
    listForMember(userId: string, serverId?: string): Promise<MembershipSnapshot[]>

    /**
     * Point the live server at a new icon (null: none) and tell which key it
     * replaced, in one statement so two uploads cannot both "replace" the same
     * file. Null when the server is gone.
     */
    replaceIcon(serverId: string, iconKey: string | null): Promise<{ previousIconKey: string | null } | null>

    /**
     * One change to the categories and channels (REQ-SRV-02). In one
     * transaction: lock the live server's row, read it and the member as they
     * are now, let `decide` turn that into writes (or throw), and carry the
     * writes out. Every such change to a server waits for the one before, so
     * none decides on a stale list.
     *
     * Null, with nothing written, when the server is gone or they are not in
     * it. Otherwise the id of the row created, if a write created one.
     */
    changeLayout(
        serverId: string,
        userId: string,
        decide: (state: LayoutState) => LayoutWrite[]
    ): Promise<{ createdId: string | null } | null>
}

export const SERVER_REPOSITORY = Symbol('ServerRepositoryPort')
