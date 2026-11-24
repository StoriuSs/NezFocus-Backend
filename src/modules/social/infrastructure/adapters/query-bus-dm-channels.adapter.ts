import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { DmChannelsPort } from '@/modules/realtime'
import { ListDmChannelIdsQuery } from '../../application'

/**
 * Realtime's DM_CHANNELS port, answered by this module (D-242): this module
 * imports realtime, so realtime asks through this adapter, given by the
 * global DmChannelsModule. Only sends this module's own query.
 */
@Injectable()
export class QueryBusDmChannels implements DmChannelsPort {
    constructor(private readonly queryBus: QueryBus) {}

    channelIdsOf(userId: string): Promise<string[]> {
        return this.queryBus.execute(new ListDmChannelIdsQuery(userId))
    }
}
