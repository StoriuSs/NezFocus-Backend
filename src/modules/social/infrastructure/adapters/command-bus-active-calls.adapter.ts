import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import type { ActiveCallsPort } from '@/modules/voice'
import { EndActiveCallCommand } from '../../application'

/**
 * Voice's ACTIVE_CALLS port, answered by this module (D-246): this module
 * imports voice (CALL_MEDIA), so voice asks through this adapter, given by
 * the global ActiveCallsModule. Only sends this module's own command.
 */
@Injectable()
export class CommandBusActiveCalls implements ActiveCallsPort {
    constructor(private readonly commandBus: CommandBus) {}

    endFor(userId: string): Promise<void> {
        return this.commandBus.execute(new EndActiveCallCommand(userId))
    }
}
