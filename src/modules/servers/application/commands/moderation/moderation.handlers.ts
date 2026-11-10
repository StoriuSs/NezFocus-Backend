import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { planBan, planKick, planTimeout, planUnban } from '../../../domain'
import { Moderate } from '../../services/moderate'
import { BanMemberCommand, KickMemberCommand, TimeoutMemberCommand, UnbanMemberCommand } from './moderation.commands'

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

export const MODERATION_COMMAND_HANDLERS = [
    KickMemberHandler,
    BanMemberHandler,
    UnbanMemberHandler,
    TimeoutMemberHandler
]
