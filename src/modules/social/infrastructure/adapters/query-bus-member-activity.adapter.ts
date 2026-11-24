import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { MemberActivity, MemberActivityPort } from '@/modules/servers'
import { ListActivitiesQuery } from '../../application'
import type { Activity } from '../../domain'

/**
 * Servers' MEMBER_ACTIVITY port, answered by this module (D-247): this
 * module imports servers, so servers asks through this adapter, given by
 * the global MemberActivityModule. Only sends this module's own query.
 */
@Injectable()
export class QueryBusMemberActivity implements MemberActivityPort {
    constructor(private readonly queryBus: QueryBus) {}

    activitiesOf(userIds: string[]): Promise<Map<string, MemberActivity>> {
        // Typed, so a change of social's Activity that servers' MemberActivity cannot hold fails to compile.
        return this.queryBus.execute<ListActivitiesQuery, Map<string, Activity>>(new ListActivitiesQuery(userIds))
    }
}
