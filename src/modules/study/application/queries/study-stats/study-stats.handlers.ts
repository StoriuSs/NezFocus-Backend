import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    addDays,
    averageSeconds,
    comparedDays,
    DayStudy,
    FALLBACK_TIME_ZONE,
    gridOf,
    HISTORY_PAGE_SIZE,
    HistoryCursor,
    HistoryRow,
    instantsOf,
    LocalDate,
    localDateOf,
    mayBeBestWeek,
    periodOf,
    previousPeriod,
    SessionKind,
    shownStreak,
    StaleStudyCursorError,
    STUDY_STATS_REPOSITORY,
    StudyStatsRepositoryPort,
    StudyView
} from '../../../domain'
import { HistoryPlace, historyPlaces } from '../../services/history-places'
import { GetStudyStatsQuery, ListStudySessionsQuery } from './study-stats.queries'

/** A day of the period: its seconds, split into room and Solo (D-104); 0 when nothing was counted. */
export type StudyDayView = DayStudy

/** The Stats page's numbers as `GET /me/study-stats` gives them (D-105, D-230). */
export interface StudyStatsView {
    view: StudyView
    /** Today in the person's zone: the client marks it and leaves the days after it empty. */
    today: LocalDate
    period: { start: LocalDate; end: LocalDate }
    /** Every day of the period, in order, the days still ahead included. */
    days: StudyDayView[]
    totalSeconds: number
    roomSeconds: number
    soloSeconds: number
    /**
     * The period before over as many first days as this one has gone by (all
     * of it once this one is over); null, with no comparison shown, when
     * nothing was counted before this period (its first one), or for a
     * period still ahead (no day of it gone by to compare).
     */
    previousSeconds: number | null
    /**
     * All of the period before, null when previousSeconds is: 0 says
     * "Tuần trước chưa học", which the part compared alone cannot (a
     * Wednesday against a week studied only Friday to Sunday, D-230).
     */
    previousPeriodSeconds: number | null
    /** The mean a day over the days of the period gone by, today in, rounded down. */
    averageSeconds: number
    allTimeSeconds: number
    /** The first day with a second counted, where "‹" stops; null for one who never studied. */
    firstDate: LocalDate | null
    /** The streak to show today (REQ-STUDY-07) and the longest. */
    streak: { current: number; longest: number }
    todaySeconds: number
    /**
     * Where the count of the session one is in stands, null when in none:
     * the client adds the focus running after it to todaySeconds (D-224, D-231).
     */
    countedUntil: Date | null
    /** When today's seconds and countedUntil were read: the client keeps the later read (D-232). */
    readAt: Date
    /** A week's 4-week grid, the 28 days up to its Sunday (D-104); null for a month. */
    grid: { date: LocalDate; focusedSeconds: number }[] | null
    /**
     * The greatest total of any other week: the week shown is the best when
     * its own is greater (D-230). Null for a month, and for a week that may
     * not be the best (the first with seconds, or one before it).
     */
    bestOtherWeekSeconds: number | null
}

/** Every date from `start` to `end`, both in. */
function datesFrom(start: LocalDate, end: LocalDate): LocalDate[] {
    const dates: LocalDate[] = []
    for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date)
    return dates
}

/**
 * The Stats page and the streak block of the Study page (REQ-STUDY-07):
 * the week or month asked for, in the days of DailyStudy as they were
 * counted, against "today" in the zone of one's settings. The streak, today
 * and the lifetime total are always the current ones (D-104). The client adds
 * the focus time running after the last count (D-224).
 */
@QueryHandler(GetStudyStatsQuery)
export class GetStudyStatsHandler implements IQueryHandler<GetStudyStatsQuery> {
    constructor(
        @Inject(STUDY_STATS_REPOSITORY) private readonly stats: StudyStatsRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async execute({ userId, view, date }: GetStudyStatsQuery): Promise<StudyStatsView> {
        const zone = (await this.users.timeZoneOf(userId)) ?? FALLBACK_TIME_ZONE
        const today = localDateOf(new Date(), zone)
        const period = periodOf(view, date ?? today)
        const grid = view === 'week' ? gridOf(period) : null
        const compared = comparedDays(period, today)
        const before = previousPeriod(period)
        const [rows, todayStudy, lifetime, streak, previous, previousWhole, bestOther] = await Promise.all([
            this.stats.daysOf(userId, grid?.start ?? period.start, period.end),
            this.stats.todayOf(userId, today),
            this.stats.lifetimeOf(userId),
            this.stats.streakOf(userId),
            compared ? this.stats.secondsBetween(userId, compared.start, compared.end) : null,
            this.stats.secondsBetween(userId, before.start, before.end),
            view === 'week' ? this.stats.bestWeekExcept(userId, period.start) : null
        ])

        const byDate = new Map(rows.map((row) => [row.date, row]))
        const days = datesFrom(period.start, period.end).map(
            (day) => byDate.get(day) ?? { date: day, focusedSeconds: 0, roomSeconds: 0, soloSeconds: 0 }
        )
        const sum = (field: 'focusedSeconds' | 'roomSeconds' | 'soloSeconds') =>
            days.reduce((total, day) => total + day[field], 0)
        const totalSeconds = sum('focusedSeconds')
        const { firstDate } = lifetime
        const compares = firstDate !== null && firstDate < period.start && previous !== null
        return {
            view,
            today,
            period: { start: period.start, end: period.end },
            days,
            totalSeconds,
            roomSeconds: sum('roomSeconds'),
            soloSeconds: sum('soloSeconds'),
            previousSeconds: compares ? previous : null,
            previousPeriodSeconds: compares ? previousWhole : null,
            averageSeconds: averageSeconds(totalSeconds, period, today),
            allTimeSeconds: lifetime.totalSeconds,
            firstDate,
            streak: { current: shownStreak(streak, today), longest: streak.longest },
            todaySeconds: todayStudy.seconds,
            countedUntil: todayStudy.countedUntil,
            readAt: todayStudy.readAt,
            grid:
                grid &&
                datesFrom(grid.start, grid.end).map((day) => ({
                    date: day,
                    focusedSeconds: byDate.get(day)?.focusedSeconds ?? 0
                })),
            bestOtherWeekSeconds: view === 'week' && mayBeBestWeek(period, firstDate) ? bestOther : null
        }
    }
}

/** A line of the history as the API gives it (C-47): where, when, how long, how many joins. */
export interface StudySessionLineView extends HistoryPlace {
    sessionId: string
    kind: SessionKind
    firstJoinedAt: Date
    /** Null while one is in it: the line "Đang học", its time "– bây giờ". */
    lastLeftAt: Date | null
    seconds: number
    joinCount: number
}

/** A page of the history (D-105): the next one starts after the last line's session. */
export interface StudySessionPage {
    items: StudySessionLineView[]
    hasMore: boolean
}

/**
 * One's sessions of the week or month (REQ-STUDY-07, D-105, D-229, D-230):
 * the one they are in first, on the first page, even with no second counted
 * yet (the client adds what runs); then those with a second counted, the
 * latest first join first, 20 a page. A session belongs to the period of
 * their first join in it, in the zone of their settings now. Each line names
 * its room as they may know it now.
 */
@QueryHandler(ListStudySessionsQuery)
export class ListStudySessionsHandler implements IQueryHandler<ListStudySessionsQuery> {
    constructor(
        @Inject(STUDY_STATS_REPOSITORY) private readonly stats: StudyStatsRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async execute({ userId, view, date, cursor }: ListStudySessionsQuery): Promise<StudySessionPage> {
        const now = new Date()
        const zone = (await this.users.timeZoneOf(userId)) ?? FALLBACK_TIME_ZONE
        const window = instantsOf(periodOf(view, date ?? localDateOf(now, zone)), zone)
        const after = cursor === null ? null : await this.cursorOf(userId, cursor)
        const [open, page] = await Promise.all([
            after ? null : this.stats.openLineOf(userId, window),
            this.stats.linesOf(userId, window, after, HISTORY_PAGE_SIZE + 1)
        ])
        // Left between the two reads, the session one was in may be in both: once, first.
        const closed = page.slice(0, HISTORY_PAGE_SIZE).filter((row) => row.sessionId !== open?.sessionId)
        const rows: HistoryRow[] = [...(open ? [open] : []), ...closed]
        const places = await historyPlaces({ channels: this.channels, checker: this.checker }, userId, rows, now)
        return {
            items: rows.map((row) => ({
                sessionId: row.sessionId,
                kind: row.kind,
                firstJoinedAt: row.firstJoinedAt,
                lastLeftAt: row.lastLeftAt,
                seconds: row.seconds,
                joinCount: row.joinCount,
                ...places.get(row.sessionId)!
            })),
            hasMore: page.length > HISTORY_PAGE_SIZE
        }
    }

    /** Where to go on from: the first join of the session named, which their coming back does not move. */
    private async cursorOf(userId: string, sessionId: string): Promise<HistoryCursor> {
        const firstJoinedAt = await this.stats.firstJoinOf(userId, sessionId)
        if (!firstJoinedAt) throw new StaleStudyCursorError(sessionId)
        return { firstJoinedAt, sessionId }
    }
}

export const STUDY_STATS_QUERY_HANDLERS = [GetStudyStatsHandler, ListStudySessionsHandler]
