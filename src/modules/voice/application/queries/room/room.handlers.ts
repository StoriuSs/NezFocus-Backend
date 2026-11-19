import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '../../../domain'
import { RoomPersonView, roomPeople } from '../../services/room-people'
import { ListRoomPeopleQuery } from './room.queries'

/** The people of each room asked for, in the order they joined; an empty list for a room nobody is in. */
@QueryHandler(ListRoomPeopleQuery)
export class ListRoomPeopleHandler implements IQueryHandler<ListRoomPeopleQuery> {
    constructor(
        @Inject(VOICE_STATE_REPOSITORY) private readonly states: VoiceStateRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    execute({ channelIds }: ListRoomPeopleQuery): Promise<Map<string, RoomPersonView[]>> {
        return roomPeople(
            { states: this.states, users: this.users, channels: this.channels, checker: this.checker },
            channelIds
        )
    }
}

export const ROOM_QUERY_HANDLERS = [ListRoomPeopleHandler]
