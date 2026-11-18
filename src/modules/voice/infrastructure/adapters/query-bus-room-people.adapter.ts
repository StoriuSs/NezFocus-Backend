import { Injectable } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { RoomPeoplePort, RoomPerson } from '@/modules/servers'
import { ListRoomPeopleQuery } from '../../application'

/**
 * Servers' ROOM_PEOPLE port, answered by this module (D-205): this module
 * imports servers, so servers cannot import it and asks through this
 * adapter, given by the global RoomPeopleModule. Only sends this module's
 * own query; the handler does the reading.
 */
@Injectable()
export class QueryBusRoomPeople implements RoomPeoplePort {
    constructor(private readonly queryBus: QueryBus) {}

    peopleOf(channelIds: string[]): Promise<Map<string, RoomPerson[]>> {
        return this.queryBus.execute(new ListRoomPeopleQuery(channelIds))
    }
}
