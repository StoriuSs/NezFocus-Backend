import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { RoomSession } from '@/modules/servers'
import { FOCUS_SESSION_REPOSITORY, FocusSessionRepositoryPort } from '../../../domain'
import { sessionView } from '../../services/session-views'
import { ListRoomSessionsQuery } from './room-session.queries'

/**
 * The session not yet ended of each room asked for that has one, as the
 * clients get it (D-220): read at one time, with that time as serverTime.
 * The caller has decided the rooms may be shown.
 */
@QueryHandler(ListRoomSessionsQuery)
export class ListRoomSessionsHandler implements IQueryHandler<ListRoomSessionsQuery> {
    constructor(@Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort) {}

    async execute({ channelIds }: ListRoomSessionsQuery): Promise<Map<string, RoomSession>> {
        const open = await this.sessions.openInRooms(channelIds)
        const now = new Date()
        return new Map([...open].map(([channelId, session]) => [channelId, sessionView(session, now)]))
    }
}

export const ROOM_SESSION_QUERY_HANDLERS = [ListRoomSessionsHandler]
