import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler, IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CACHE, PERMISSION_CHECKER, PermissionCachePort, PermissionCheckerPort } from '@/modules/permissions'
import {
    ModerationState,
    ModerationWrite,
    planBan,
    planKick,
    planTimeout,
    planUnban,
    ServerNotFoundError
} from '../../domain'
import { BanListItem, MODERATION_REPOSITORY, ModerationRepositoryPort } from '../ports'
import { requireServerPermission } from '../require-permission'
import {
    BanMemberCommand,
    KickMemberCommand,
    ListBansQuery,
    TimeoutMemberCommand,
    UnbanMemberCommand
} from './moderation.messages'

/**
 * What every kick, ban, unban and timeout does around its own rule: run it in
 * the locked transaction, answer NOT_FOUND when the server is gone or they
 * are not in it, and, after the commit, tell the permission cache that the
 * member left or was timed out (D-146), so it holds from the next request.
 */
abstract class Moderate {
    constructor(
        @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort
    ) {}

    protected async change(
        serverId: string,
        userId: string,
        targetId: string,
        decide: (state: ModerationState, now: Date) => ModerationWrite[]
    ): Promise<void> {
        let writes: ModerationWrite[] = []
        const done = await this.moderation.change(serverId, userId, targetId, (state) => {
            // Read once the lock is held, as the roles do.
            writes = decide(state, new Date())
            return writes
        })
        if (!done) throw new ServerNotFoundError(serverId)
        // An unban changes no member: they are not in the server.
        const members = writes.filter((write) => write.kind !== 'unban').map((write) => write.userId)
        await Promise.all(members.map((member) => this.cache.memberChanged(serverId, member)))
    }
}

@CommandHandler(KickMemberCommand)
export class KickMemberHandler extends Moderate implements ICommandHandler<KickMemberCommand> {
    async execute({ userId, serverId, targetId, reason }: KickMemberCommand): Promise<void> {
        await this.change(serverId, userId, targetId, (s, now) => planKick(s, targetId, reason, now))
    }
}

@CommandHandler(BanMemberCommand)
export class BanMemberHandler extends Moderate implements ICommandHandler<BanMemberCommand> {
    async execute({ userId, serverId, targetId, reason }: BanMemberCommand): Promise<void> {
        await this.change(serverId, userId, targetId, (s, now) => planBan(s, targetId, reason, now))
    }
}

@CommandHandler(UnbanMemberCommand)
export class UnbanMemberHandler extends Moderate implements ICommandHandler<UnbanMemberCommand> {
    async execute({ userId, serverId, targetId }: UnbanMemberCommand): Promise<void> {
        await this.change(serverId, userId, targetId, (s, now) => planUnban(s, targetId, now))
    }
}

@CommandHandler(TimeoutMemberCommand)
export class TimeoutMemberHandler extends Moderate implements ICommandHandler<TimeoutMemberCommand> {
    async execute({ userId, serverId, targetId, seconds, reason }: TimeoutMemberCommand): Promise<void> {
        await this.change(serverId, userId, targetId, (s, now) => planTimeout(s, targetId, seconds, reason, now))
    }
}

@QueryHandler(ListBansQuery)
export class ListBansHandler implements IQueryHandler<ListBansQuery> {
    constructor(
        @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async execute({ userId, serverId, page, limit }: ListBansQuery): Promise<{ items: BanListItem[]; total: number }> {
        await requireServerPermission(this.checker, serverId, userId, 'BAN_MEMBERS')
        return this.moderation.bans(serverId, page, limit)
    }
}

export const MODERATION_HANDLERS = [
    KickMemberHandler,
    BanMemberHandler,
    UnbanMemberHandler,
    TimeoutMemberHandler,
    ListBansHandler
]
