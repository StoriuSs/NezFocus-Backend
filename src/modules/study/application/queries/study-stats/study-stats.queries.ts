import { LocalDate, StudyView } from '../../../domain'

/**
 * Every number of the Stats page for the week or month holding `date`
 * (today when null, in the person's zone), and the current streak
 * (`GET /me/study-stats`, D-105, D-230).
 */
export class GetStudyStatsQuery {
    constructor(
        readonly userId: string,
        readonly view: StudyView,
        readonly date: LocalDate | null
    ) {}
}

/**
 * A page of the person's sessions of the week or month holding `date`
 * (`GET /me/study-sessions`, D-105, D-229, D-230): after the session
 * `cursor` names, or the first page with the session they are in.
 */
export class ListStudySessionsQuery {
    constructor(
        readonly userId: string,
        readonly view: StudyView,
        readonly date: LocalDate | null,
        readonly cursor: string | null
    ) {}
}
