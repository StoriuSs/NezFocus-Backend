import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { liveSockets, SILENCE_MS, type Presence } from '../../../domain'
import { announcePresence, PresenceHandler } from '../../services/presence'
import {
    ConnectPresenceCommand,
    DisconnectPresenceCommand,
    HeartbeatCommand,
    ReportIdleCommand,
    SweepPresenceCommand
} from './presence.commands'

/** A socket let in: kept as a tab in use; answers what others now see, for `ready`. */
@CommandHandler(ConnectPresenceCommand)
export class ConnectPresenceHandler extends PresenceHandler implements ICommandHandler<ConnectPresenceCommand> {
    execute({ userId, socketId }: ConnectPresenceCommand): Promise<Presence> {
        return this.changing(
            userId,
            async () => {
                const now = Date.now()
                await this.deps.store.touch(userId, socketId, now, false)
                return announcePresence(this.deps, userId, now)
            },
            'online'
        )
    }
}

/** A socket closed: the person may change (the tab in use went); the 60 seconds start once no tab is left. */
@CommandHandler(DisconnectPresenceCommand)
export class DisconnectPresenceHandler extends PresenceHandler implements ICommandHandler<DisconnectPresenceCommand> {
    async execute({ userId, socketId }: DisconnectPresenceCommand): Promise<void> {
        await this.changing(
            userId,
            async () => {
                const now = Date.now()
                await this.deps.store.remove(userId, socketId, now)
                await announcePresence(this.deps, userId, now)
            },
            undefined
        )
    }
}

/**
 * A tab still there. Only kept, unless the sweep had dropped it (silent too
 * long, D-174), or another tab of the person has gone silent (its app
 * instance went without saying: the sweep never looks at someone still
 * beating): then what others see is worked out again.
 */
@CommandHandler(HeartbeatCommand)
export class HeartbeatHandler extends PresenceHandler implements ICommandHandler<HeartbeatCommand> {
    async execute({ userId, socketId }: HeartbeatCommand): Promise<void> {
        await this.changing(
            userId,
            async () => {
                const now = Date.now()
                const was = await this.deps.store.touch(userId, socketId, now)
                const sockets = [...(await this.deps.store.read(userId)).sockets.values()]
                if (!was || liveSockets(sockets, now).length < sockets.length) {
                    await announcePresence(this.deps, userId, now)
                }
            },
            undefined
        )
    }
}

/** A tab gone unused for 10 minutes, or in use again: away once every tab is (REQ-AUTH-07). Said twice, nothing changes. */
@CommandHandler(ReportIdleCommand)
export class ReportIdleHandler extends PresenceHandler implements ICommandHandler<ReportIdleCommand> {
    async execute({ userId, socketId, idle }: ReportIdleCommand): Promise<void> {
        await this.changing(
            userId,
            async () => {
                const now = Date.now()
                const was = await this.deps.store.touch(userId, socketId, now, idle)
                if (was?.idle !== idle) await announcePresence(this.deps, userId, now)
            },
            undefined
        )
    }
}

/**
 * Every 15 seconds (src/maintenance, D-174): the people not heard from for
 * 60 seconds, every tab closed or on an app instance that went without
 * saying, go offline. One that fails is kept, and tried again at the next
 * sweep.
 */
@CommandHandler(SweepPresenceCommand)
export class SweepPresenceHandler extends PresenceHandler implements ICommandHandler<SweepPresenceCommand> {
    async execute({ now }: SweepPresenceCommand): Promise<void> {
        const at = now.getTime()
        let silent: string[] = []
        try {
            silent = await this.deps.store.silentSince(at - SILENCE_MS)
        } catch (error) {
            this.logger.warn(`Presence not swept: ${(error as Error)?.message}`)
        }
        for (const userId of silent) {
            await this.changing(userId, () => announcePresence(this.deps, userId, at), undefined)
        }
    }
}

export const PRESENCE_COMMAND_HANDLERS = [
    ConnectPresenceHandler,
    DisconnectPresenceHandler,
    HeartbeatHandler,
    ReportIdleHandler,
    SweepPresenceHandler
]
