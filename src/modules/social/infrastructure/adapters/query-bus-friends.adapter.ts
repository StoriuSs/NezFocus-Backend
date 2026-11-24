import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { FriendsPort } from '@/modules/realtime'
import { ListFriendIdsQuery } from '../../application'

/**
 * Realtime's FRIENDS port, answered by this module (D-242): this module
 * imports realtime, so realtime asks through this adapter, given by the
 * global FriendsModule. Only sends this module's own query.
 */
@Injectable()
export class QueryBusFriends implements FriendsPort {
    constructor(private readonly queryBus: QueryBus) {}

    friendIdsOf(userId: string): Promise<string[]> {
        return this.queryBus.execute(new ListFriendIdsQuery(userId))
    }
}
