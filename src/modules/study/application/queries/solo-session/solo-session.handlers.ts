import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Cycle, FIRST_SOLO_CYCLE, FOCUS_SESSION_REPOSITORY, FocusSessionRepositoryPort } from '../../../domain'
import { FocusSessionView, sessionView } from '../../services/session-views'
import { GetSoloSessionQuery } from './solo-session.queries'

/** A person's Solo as GET /me/solo-session gives it (D-229). */
export interface SoloSessionView {
    /** Their Solo not yet ended; null when they have none. */
    session: FocusSessionView | null
    /** The cycle POST /me/solo-session starts with when sent none: their last Solo's, or 25/5 (D-103). */
    startCycle: Cycle
}

/**
 * A person's Solo not yet ended, so a reload brings its clock back
 * (REQ-STUDY-05), and the cycle the start button names ("Bắt đầu Tập
 * trung 50 phút", D-103): the last Solo's, ended or not.
 */
@QueryHandler(GetSoloSessionQuery)
export class GetSoloSessionHandler implements IQueryHandler<GetSoloSessionQuery> {
    constructor(@Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepositoryPort) {}

    async execute({ userId }: GetSoloSessionQuery): Promise<SoloSessionView> {
        const [solo, last] = await Promise.all([this.sessions.openSolo(userId), this.sessions.lastSoloCycle(userId)])
        return { session: solo && sessionView(solo, new Date()), startCycle: last ?? FIRST_SOLO_CYCLE }
    }
}

export const SOLO_SESSION_QUERY_HANDLERS = [GetSoloSessionHandler]
