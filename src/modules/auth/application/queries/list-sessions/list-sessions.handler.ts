import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { ListSessionsQuery } from './list-sessions.query'
import {
    ActiveSession,
    DeviceKind,
    SESSION_REPOSITORY,
    SessionRepositoryPort,
    describeDevice,
    maskIp
} from '@/modules/auth/domain'

/** One row of the list of sessions (S-ME-03). */
export interface SessionSummary {
    id: string
    /** null: not one it can name ("Unknown browser") */
    browser: string | null
    os: string | null
    device: DeviceKind
    /** The network only (D-138); null when the request had no address. */
    ip: string | null
    /** The last refresh, or the sign-in before any. */
    lastActiveAt: Date
    signedInAt: Date
    /** The session asking: "This device". */
    current: boolean
}

/**
 * The signed-in user's live sessions (REQ-AUTH-03, D-75): this device first,
 * then the most recently used, a tie going to the later sign-in (10-settings
 * Q9). The browser, system and IP are those of the last refresh (D-138), read
 * and masked here: the stored user agent and full address stay on the server.
 */
@QueryHandler(ListSessionsQuery)
export class ListSessionsHandler implements IQueryHandler<ListSessionsQuery> {
    constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort) {}

    async execute({ userId, currentSessionId }: ListSessionsQuery): Promise<SessionSummary[]> {
        const sessions = await this.sessions.listActive(userId, new Date())
        return sessions.sort(byListOrder(currentSessionId)).map((session) => summary(session, currentSessionId))
    }
}

const byListOrder =
    (currentSessionId: string) =>
    (a: ActiveSession, b: ActiveSession): number =>
        Number(b.id === currentSessionId) - Number(a.id === currentSessionId) ||
        b.lastUsedAt.getTime() - a.lastUsedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime()

function summary(session: ActiveSession, currentSessionId: string): SessionSummary {
    const { browser, os, kind } = describeDevice(session.userAgent)
    return {
        id: session.id,
        browser,
        os,
        device: kind,
        ip: maskIp(session.ip),
        lastActiveAt: session.lastUsedAt,
        signedInAt: session.createdAt,
        current: session.id === currentSessionId
    }
}
