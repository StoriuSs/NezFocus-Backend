import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { EVENT_PUBLISHER, EventPublisherPort, TypingSignalledEvent } from '@/modules/realtime'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { DomainError, isHidden, LimitsUnavailableError } from '@/shared/domain'
import { DM_ACCESS, DmAccessPort, SEND_LIMIT, SendLimitPort } from '../../ports'
import { TYPING_PER_TAB } from '../../rate-limits'
import { openChannel, requireSending } from '../../services/channel-access'

/**
 * A tab says its person is typing (REQ-MSG-06, sent over its socket): the
 * channel's viewers hear `typing.started` with who, and show it for 10
 * seconds. Counted first, per tab and channel (application/rate-limits.ts),
 * so a signal refused later costs no more than one told; while the counter
 * cannot be reached it goes on, like a message (SRS 1.69). Told only for
 * someone who may post there now (a timeout or a channel only managers post
 * in says nothing; in a DM, someone who may still message the other one,
 * D-238), not invisible: typing would show they are there
 * (D-176), and not an account waiting to be deleted, which others see as
 * deleted (D-182; a tab whose socket was not cut yet). Nothing is stored, and a signal that cannot be told is dropped
 * quietly: there is no one to answer.
 */
@EventsHandler(TypingSignalledEvent)
export class PublishTypingHandler implements IEventHandler<TypingSignalledEvent> {
    private readonly logger = new Logger(PublishTypingHandler.name)

    constructor(
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly permissions: PermissionCheckerPort,
        @Inject(SEND_LIMIT) private readonly limit: SendLimitPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(DM_ACCESS) private readonly dms: DmAccessPort
    ) {}

    async handle({ userId, socketId, channelId }: TypingSignalledEvent): Promise<void> {
        try {
            if (await this.tooSoon(`${socketId}:${channelId}`)) return
            const now = new Date()
            const access = { channels: this.channels, checker: this.permissions, dms: this.dms }
            const channel = await openChannel(access, channelId, userId, now, 'write')
            requireSending(channel, now)
            if ((await this.users.presenceOf(userId)) === 'invisible') return
            const user = await this.users.findById(userId)
            if (!user || isHidden(user)) return
            this.publisher.toChannel(channelId, 'typing.started', {
                channelId,
                user: { id: user.id, username: user.username, displayName: user.displayName }
            })
        } catch (error) {
            if (!(error instanceof DomainError)) this.logger.warn(`Typing not told: ${(error as Error)?.message}`)
        }
    }

    private async tooSoon(tabInChannel: string): Promise<boolean> {
        try {
            return (await this.limit.hit(TYPING_PER_TAB, tabInChannel)).limited
        } catch (error) {
            if (error instanceof LimitsUnavailableError) return false
            throw error
        }
    }
}
