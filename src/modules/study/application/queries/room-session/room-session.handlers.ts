import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort, RoomSession } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { isHidden } from '@/shared/domain'
import {
    FOCUS_SESSION_REPOSITORY,
    FocusSessionRepositoryPort,
    nextHost,
    StudyForbiddenError,
    StudyRoomNotFoundError
} from '../../../domain'
import { sessionView } from '../../services/session-views'
import { mayHostWith, studyStanding } from '../../services/study-access'
import { GetNextHostQuery, ListRoomSessionsQuery } from './room-session.queries'

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

/** Who would control a session next, as "Rời phòng?" names them; no name for an account shown as deleted (D-182). */
export interface NextHostView {
    id: string
    displayName: string | null
}

/**
 * Who would control a Room Session if its Host left now (REQ-STUDY-03,
 * D-233): the next Host by the same rule as a leaving (nextHost), the Host
 * left out; null when nobody present may start, so it would run with no
 * Host. Only its Host asks: a manager who is not the Host is FORBIDDEN
 * `not_host`, as is anyone else who sees the room; a session one may not
 * see, ended, a Solo or none is NOT_FOUND (NFR-SEC-05). Read, not locked:
 * someone may come or go before the Host answers the question.
 */
@QueryHandler(GetNextHostQuery)
export class GetNextHostHandler implements IQueryHandler<GetNextHostQuery> {
    constructor(
        @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async execute({ userId, sessionId }: GetNextHostQuery): Promise<NextHostView | null> {
        const session = await this.sessions.find(sessionId)
        const channelId = session?.kind === 'room' && session.status !== 'ended' ? session.channelId : null
        if (!channelId) throw new StudyRoomNotFoundError(sessionId)
        const sources = { channels: this.channels, checker: this.checker }
        await studyStanding(sources, channelId, userId, new Date())
        if (session!.hostId !== userId) throw new StudyForbiddenError('not_host')

        const present = (await this.sessions.presentIn(sessionId)).filter((person) => person.userId !== userId)
        const mayHost = mayHostWith(sources)
        // Every one asked: a room holds few, and the rule then never asks again.
        const asked = new Map(
            await Promise.all(
                present.map(async (person) => [person.userId, await mayHost(channelId, person.userId)] as const)
            )
        )
        const next = nextHost(present, asked)
        if (!next) return null
        const user = await this.users.findById(next)
        return { id: next, displayName: user && !isHidden(user) ? (user.displayName ?? user.username) : null }
    }
}

export const ROOM_SESSION_QUERY_HANDLERS = [ListRoomSessionsHandler, GetNextHostHandler]
