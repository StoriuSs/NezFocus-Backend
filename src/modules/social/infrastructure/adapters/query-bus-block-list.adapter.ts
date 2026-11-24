import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { BlockListPort } from '@/modules/notifications'
import { ListBlockedIdsQuery, ListBlockersAmongQuery } from '../../application'

/**
 * Notifications' BLOCK_LIST port, answered by this module (D-242): this
 * module calls notifications' NOTIFIER, so notifications asks through this
 * adapter, given by the global BlockListModule. Only sends this module's
 * own queries.
 */
@Injectable()
export class QueryBusBlockList implements BlockListPort {
    constructor(private readonly queryBus: QueryBus) {}

    blockedBy(userId: string): Promise<string[]> {
        return this.queryBus.execute(new ListBlockedIdsQuery(userId))
    }

    blockersAmong(blockedId: string, userIds: string[]): Promise<string[]> {
        if (userIds.length === 0) return Promise.resolve([])
        return this.queryBus.execute(new ListBlockersAmongQuery(blockedId, userIds))
    }
}
