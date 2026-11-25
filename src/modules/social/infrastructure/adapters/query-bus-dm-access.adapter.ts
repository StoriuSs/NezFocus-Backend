import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { DmAccessPort, DmConversation } from '@/modules/messaging'
import { CanMessageInDmQuery, GetDmConversationQuery, ListBlockedIdsQuery, ListShownDmsQuery } from '../../application'

/**
 * Messaging's DM_ACCESS port, answered by this module (D-238): this module
 * imports messaging (LAST_MESSAGES), so messaging asks through this
 * adapter, given by the global DmAccessModule. Only sends this module's own
 * queries.
 */
@Injectable()
export class QueryBusDmAccess implements DmAccessPort {
    constructor(private readonly queryBus: QueryBus) {}

    conversation(channelId: string): Promise<DmConversation | null> {
        return this.queryBus.execute(new GetDmConversationQuery(channelId))
    }

    canMessage(userId: string, channelId: string): Promise<boolean> {
        return this.queryBus.execute(new CanMessageInDmQuery(userId, channelId))
    }

    shownOf(userId: string): Promise<DmConversation[]> {
        return this.queryBus.execute(new ListShownDmsQuery(userId))
    }

    blockedBy(userId: string): Promise<string[]> {
        return this.queryBus.execute(new ListBlockedIdsQuery(userId))
    }
}
