import { AccessMember } from '@/modules/permissions'
import { ServerPlan, ServerSnapshot } from '../../domain'

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
}

export const SERVER_REPOSITORY = Symbol('ServerRepositoryPort')
