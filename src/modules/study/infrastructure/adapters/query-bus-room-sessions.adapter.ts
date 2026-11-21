import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { RoomSession, RoomSessionsPort } from '@/modules/servers'
import { ListRoomSessionsQuery } from '../../application'

/**
 * Servers' ROOM_SESSIONS port, answered by this module (D-220): this module
 * imports servers, so servers cannot import it and asks through this
 * adapter, given by the global RoomSessionsModule. Only sends this module's
 * own query; the handler does the reading.
 */
@Injectable()
export class QueryBusRoomSessions implements RoomSessionsPort {
    constructor(private readonly queryBus: QueryBus) {}

    sessionsOf(channelIds: string[]): Promise<Map<string, RoomSession>> {
        return this.queryBus.execute(new ListRoomSessionsQuery(channelIds))
    }
}
