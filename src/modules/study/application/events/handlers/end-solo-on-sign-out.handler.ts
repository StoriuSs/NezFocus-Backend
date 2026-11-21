import { Logger } from '@nestjs/common'
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { AccountDeletionRequestedEvent, SignedOutEvent } from '@/modules/auth'
import { EndSignedOutSoloCommand } from '../../commands/solo-session/solo-session.commands'

/**
 * One who pressed Đăng xuất, on any device, stops their Solo (D-229, spec
 * 10): it belongs to no one device, so only signing out, not a session
 * ended otherwise, ends it. So does an account that starts to wait for
 * deletion, signed out everywhere (D-229), as voice puts it out of its room
 * (D-210).
 *
 * Not retried (adding-a-module.md › Events): a Solo left running ends by
 * itself (a wait not taken up), or its person stops it when back.
 */
@EventsHandler(SignedOutEvent, AccountDeletionRequestedEvent)
export class EndSoloOnSignOutHandler implements IEventHandler<SignedOutEvent | AccountDeletionRequestedEvent> {
    private readonly logger = new Logger(EndSoloOnSignOutHandler.name)

    constructor(private readonly commandBus: CommandBus) {}

    async handle({ userId }: SignedOutEvent | AccountDeletionRequestedEvent): Promise<void> {
        try {
            await this.commandBus.execute(new EndSignedOutSoloCommand(userId))
        } catch (error) {
            this.logger.warn(`The Solo of ${userId}, signed out, not ended: ${String(error)}`)
        }
    }
}
