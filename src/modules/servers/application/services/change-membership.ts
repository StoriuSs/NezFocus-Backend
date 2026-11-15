import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import {
    MembershipState,
    MembershipWrite,
    SERVER_REPOSITORY,
    ServerNotFoundError,
    ServerRepositoryPort
} from '../../domain'
import { MemberChangedEvent } from '../events/member-changed.event'
import { ServerChangedEvent } from '../events/server-changed.event'

/**
 * What each write changes in the permission cache (D-146), told after the
 * commit: one who left is no longer a member; the owner is part of the
 * server's block; a deleted server is gone from it. Every kind is decided
 * here, so a new one fails to compile rather than leave an old permission in
 * force.
 */
const TELL_CACHE: {
    [K in MembershipWrite['kind']]: (
        cache: PermissionCachePort,
        serverId: string,
        write: Extract<MembershipWrite, { kind: K }>
    ) => Promise<void>
} = {
    leave: (cache, serverId, write) => cache.memberChanged(serverId, write.userId),
    transferOwnership: (cache, serverId) => cache.serverChanged(serverId),
    deleteServer: (cache, serverId) => cache.serverChanged(serverId)
}

/**
 * What the members are told of each write (D-178): one who left; a new owner,
 * who sees every channel; a deleted server, which no one sees any more.
 */
const TOLD: {
    [K in MembershipWrite['kind']]: (
        serverId: string,
        write: Extract<MembershipWrite, { kind: K }>
    ) => ServerChangedEvent | MemberChangedEvent
} = {
    leave: (serverId, write) => new MemberChangedEvent(serverId, write.userId, 'left'),
    transferOwnership: (serverId) => new ServerChangedEvent(serverId, [{ topic: 'server', action: 'updated' }], true),
    deleteServer: (serverId) => new ServerChangedEvent(serverId, [{ topic: 'server', action: 'deleted' }], true)
}

const told = (serverId: string, write: MembershipWrite) =>
    (TOLD[write.kind] as (serverId: string, write: MembershipWrite) => ServerChangedEvent | MemberChangedEvent)(
        serverId,
        write
    )

const tellCache = (cache: PermissionCachePort, serverId: string, write: MembershipWrite) =>
    (TELL_CACHE[write.kind] as (cache: PermissionCachePort, serverId: string, write: MembershipWrite) => Promise<void>)(
        cache,
        serverId,
        write
    )

/**
 * What leaving a server, deleting it and handing it over do around their own
 * rule (REQ-SRV-05): run it in the locked transaction
 * (ServerRepositoryPort.changeMembership), answer NOT_FOUND when the server
 * is gone or they are not in it, and tell the permission cache after the
 * commit, so the next request already sees the change (D-146); then the
 * members (D-178).
 */
export abstract class ChangeMembership {
    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
        private readonly events: EventBus
    ) {}

    /** The writes carried out, for a caller with something to say about them. */
    protected async change(
        serverId: string,
        userId: string,
        targetId: string | null,
        decide: (state: MembershipState, now: Date) => MembershipWrite[]
    ): Promise<MembershipWrite[]> {
        let writes: MembershipWrite[] = []
        const done = await this.servers.changeMembership(serverId, userId, targetId, (state) => {
            // Read once the lock is held, as the roles and the moderation do.
            writes = decide(state, new Date())
            return writes
        })
        if (!done) throw new ServerNotFoundError(serverId)
        await Promise.all(writes.map((write) => tellCache(this.cache, serverId, write)))
        for (const write of writes) this.events.publish(told(serverId, write))
        return writes
    }
}
