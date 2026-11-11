import { AccessMember } from '@/modules/permissions'
import { LayoutState, LayoutWrite } from '../channel-layout'
import { MembershipState, MembershipWrite } from '../membership'
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

/** A server in the person's list, with how many are in it (D-161). */
export interface ListedMembership extends MembershipSnapshot {
    /** Everyone in it whose account is not deleted, those waiting to be deleted included. */
    memberCount: number
}

/** One person still in a live server although their account is deleted. */
export interface LeftoverMembership {
    serverId: string
    userId: string
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
    listForMember(userId: string, serverId?: string): Promise<ListedMembership[]>

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

    /**
     * One leave, deletion or handover (REQ-SRV-05). In one transaction: lock
     * the live server's row, read it, the person acting, how many others are
     * in it and the one named (a handover), let `decide` turn that into
     * writes (or throw), and carry them out. A deleted server keeps its row
     * (`deletedAt`) until `purgeDeleted`.
     *
     * False, with nothing written, when the server is gone or they are not in it.
     */
    changeMembership(
        serverId: string,
        userId: string,
        targetId: string | null,
        decide: (state: MembershipState) => MembershipWrite[]
    ): Promise<boolean>

    /** The live servers the person is in. */
    serverIdsOf(userId: string): Promise<string[]>

    /**
     * Up to `limit` people still in a live server although their account is
     * deleted: what a lost AccountDeletedEvent left behind. Not a deleted
     * owner whose server still has others in it, which nothing can settle
     * (ForgetDeletedMemberHandler logs it) and which would otherwise take a
     * place in every batch.
     */
    leftoverMemberships(limit: number): Promise<LeftoverMembership[]>

    /** Up to `limit` servers deleted before `before`, oldest first, with their icon's key. */
    deletedBefore(before: Date, limit: number): Promise<{ serverId: string; iconKey: string | null }[]>

    /** Deletes these servers for good, with everything in them, if they are still deleted. */
    purge(serverIds: string[]): Promise<void>
}

export const SERVER_REPOSITORY = Symbol('ServerRepositoryPort')
