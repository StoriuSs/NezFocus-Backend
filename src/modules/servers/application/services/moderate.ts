import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import {
    MODERATION_REPOSITORY,
    ModerationRepositoryPort,
    ModerationState,
    ModerationWrite,
    ServerNotFoundError
} from '../../domain'
import { MemberChangedEvent } from '../events/member-changed.event'
import { ServerChangedEvent } from '../events/server-changed.event'

/**
 * What the server is told of each write (D-178): one kicked or banned
 * leaves, with who removed them and why, which only they hear; one timed out
 * or let off changes; a ban lifted changes only the ban list, the one let
 * back being in no server room. A kick, a ban and a timeout also carry what
 * the person's inbox item says, with the server's name read in the write
 * (REQ-ROLE-04, D-188); a timeout ended early has no item.
 */
const TOLD: {
    [K in ModerationWrite['kind']]: (
        serverId: string,
        write: Extract<ModerationWrite, { kind: K }>,
        serverName: string
    ) => ServerChangedEvent | MemberChangedEvent
} = {
    kick: (serverId, write, serverName) =>
        new MemberChangedEvent(serverId, write.userId, 'left', 'kick', write.reason, null, {
            action: 'kick',
            serverName,
            reason: write.reason,
            timeoutUntil: null
        }),
    ban: (serverId, write, serverName) =>
        new MemberChangedEvent(serverId, write.userId, 'left', 'ban', write.reason, write.deleteMessages, {
            action: 'ban',
            serverName,
            reason: write.reason,
            timeoutUntil: null
        }),
    timeOut: (serverId, write, serverName) =>
        new MemberChangedEvent(serverId, write.userId, 'updated', null, null, null, {
            action: 'timeout',
            serverName,
            reason: write.reason,
            timeoutUntil: write.until
        }),
    endTimeout: (serverId, write) => new MemberChangedEvent(serverId, write.userId, 'updated'),
    unban: (serverId) => new ServerChangedEvent(serverId, [{ topic: 'ban', action: 'deleted' }], false)
}

const told = (serverId: string, write: ModerationWrite, serverName: string) =>
    (
        TOLD[write.kind] as (
            serverId: string,
            write: ModerationWrite,
            serverName: string
        ) => ServerChangedEvent | MemberChangedEvent
    )(serverId, write, serverName)

/**
 * What every kick, ban, unban and timeout does around its own rule: run it in
 * the locked transaction, answer NOT_FOUND when the server is gone or they
 * are not in it, and, after the commit, tell the permission cache that the
 * member left or was timed out (D-146), so it holds from the next request;
 * then the server (D-178).
 */
export abstract class Moderate {
    constructor(
        @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
        private readonly events: EventBus
    ) {}

    protected async change(
        serverId: string,
        userId: string,
        targetId: string,
        decide: (state: ModerationState, now: Date) => ModerationWrite[]
    ): Promise<void> {
        let writes: ModerationWrite[] = []
        let serverName = ''
        const done = await this.moderation.change(serverId, userId, targetId, (state) => {
            // Read once the lock is held, as the roles do.
            writes = decide(state, new Date())
            serverName = state.server.name
            return writes
        })
        if (!done) throw new ServerNotFoundError(serverId)
        // An unban changes no member: they are not in the server.
        const members = writes.filter((write) => write.kind !== 'unban').map((write) => write.userId)
        await Promise.all(members.map((member) => this.cache.memberChanged(serverId, member)))
        for (const write of writes) this.events.publish(told(serverId, write, serverName))
    }
}
