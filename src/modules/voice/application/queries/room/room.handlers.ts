import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { RoomPersonView, roomPeople } from '../../services/room-people'
import { ListRoomPeopleQuery } from './room.queries'

/** The people of each room asked for, in the order they joined; an empty list for a room nobody is in. */
@QueryHandler(ListRoomPeopleQuery)
export class ListRoomPeopleHandler implements IQueryHandler<ListRoomPeopleQuery> {
    constructor(
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    execute({ channelIds }: ListRoomPeopleQuery): Promise<Map<string, RoomPersonView[]>> {
        return roomPeople({ states: this.states, users: this.users }, channelIds)
    }
}

export const ROOM_QUERY_HANDLERS = [ListRoomPeopleHandler]
