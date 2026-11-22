import {
    addDays,
    DayStudy,
    HistoryCursor,
    HistoryRow,
    HistoryWindow,
    NO_STREAK,
    StaleStudyCursorError,
    StreakState,
    StudyStatsRepositoryPort,
    weekStartOf
} from '../../../domain'
import { studyWorld } from '../../study-test-world.shared-spec'
import { GetStudyStatsHandler, ListStudySessionsHandler } from './study-stats.handlers'
import { GetStudyStatsQuery, ListStudySessionsQuery } from './study-stats.queries'

/*
 * The Stats page of spec 08 (thế giới A): An in Asia/Ho_Chi_Minh, today
 * Sunday 18/10/2026 at 21:47. Minutes a day, room · Solo, as the spec's table.
 */
const TODAY_2147 = new Date('2026-10-18T14:47:00.000Z')

const day = (date: string, roomMinutes: number, soloMinutes = 0): DayStudy => ({
    date,
    focusedSeconds: (roomMinutes + soloMinutes) * 60,
    roomSeconds: roomMinutes * 60,
    soloSeconds: soloMinutes * 60
})

/** Minutes of the week starting `monday`, Monday first, all in rooms. */
const week = (monday: string, minutes: number[]): DayStudy[] =>
    minutes.map((each, index) => day(addDays(monday, index), each)).filter((one) => one.focusedSeconds > 0)

const WORLD_A: DayStudy[] = [
    ...week('2026-09-14', [10, 0, 25, 0, 30, 20, 5]),
    ...week('2026-09-21', [30, 45, 20, 50, 25, 60, 40]),
    ...week('2026-09-28', [35, 20, 55, 30, 15, 45, 25]),
    ...week('2026-10-05', [0, 20, 0, 30, 25, 0, 40]),
    // 12/10: 186 minutes in rooms, 89 alone (1 giờ 29 phút).
    day('2026-10-13', 50),
    day('2026-10-14', 0, 40),
    day('2026-10-15', 35),
    day('2026-10-16', 25, 35),
    day('2026-10-17', 45),
    day('2026-10-18', 31, 14)
]

/** DailyStudy and the history as the repository would read them, in memory. */
function statsOf(
    days: DayStudy[],
    lines: HistoryRow[] = [],
    streak: StreakState = NO_STREAK,
    countedUntil: Date | null = null
) {
    const within = (from: string, to: string) => days.filter((one) => one.date >= from && one.date <= to)
    const inWindow = (line: HistoryRow, window: HistoryWindow) =>
        line.firstJoinedAt >= window.from && line.firstJoinedAt < window.to
    const weeks = new Map<string, number>()
    for (const one of days) {
        const monday = weekStartOf(one.date)
        weeks.set(monday, (weeks.get(monday) ?? 0) + one.focusedSeconds)
    }
    const port: StudyStatsRepositoryPort = {
        daysOf: jest.fn(async (_userId: string, from: string, to: string) => within(from, to)),
        todayOf: jest.fn(async (_userId: string, today: string) => ({
            seconds: within(today, today)[0]?.focusedSeconds ?? 0,
            countedUntil
        })),
        secondsBetween: jest.fn(async (_userId: string, from: string, to: string) =>
            within(from, to).reduce((total, one) => total + one.focusedSeconds, 0)
        ),
        lifetimeOf: async () => ({
            totalSeconds: days.reduce((total, one) => total + one.focusedSeconds, 0),
            firstDate:
                days
                    .filter((one) => one.focusedSeconds > 0)
                    .map((one) => one.date)
                    .sort()[0] ?? null
        }),
        bestWeekExcept: jest.fn(async (_userId: string, weekStart: string) => {
            const others = [...weeks].filter(([monday, total]) => monday !== weekStart && total > 0)
            return others.length === 0 ? null : Math.max(...others.map(([, total]) => total))
        }),
        streakOf: async () => streak,
        openLineOf: jest.fn(
            async (_userId: string, window: HistoryWindow) =>
                lines.find((line) => line.lastLeftAt === null && inWindow(line, window)) ?? null
        ),
        linesOf: jest.fn(async (_userId: string, window: HistoryWindow, cursor: HistoryCursor | null, limit: number) =>
            lines
                .filter((line) => line.lastLeftAt !== null && line.seconds > 0 && inWindow(line, window))
                .sort(
                    (a, b) =>
                        b.firstJoinedAt.getTime() - a.firstJoinedAt.getTime() || (a.sessionId < b.sessionId ? 1 : -1)
                )
                .filter(
                    (line) =>
                        !cursor ||
                        line.firstJoinedAt < cursor.firstJoinedAt ||
                        (line.firstJoinedAt.getTime() === cursor.firstJoinedAt.getTime() &&
                            line.sessionId < cursor.sessionId)
                )
                .slice(0, limit)
        ),
        firstJoinOf: async (_userId: string, sessionId: string) =>
            lines.find((line) => line.sessionId === sessionId)?.firstJoinedAt ?? null
    }
    return port as StudyStatsRepositoryPort & { [K in keyof StudyStatsRepositoryPort]: jest.Mock }
}

describe('GetStudyStatsHandler', () => {
    beforeEach(() => jest.useFakeTimers({ now: TODAY_2147 }))
    afterEach(() => jest.useRealTimers())

    const run = (stats: StudyStatsRepositoryPort, view: 'week' | 'month', date: string | null, userId = 'an') =>
        new GetStudyStatsHandler(stats, studyWorld().users).execute(new GetStudyStatsQuery(userId, view, date))

    it('gives this week of spec 08 when no day is named: every day, the split, +2 giờ 40 phút, 39 minutes a day', async () => {
        const stats = await run(
            statsOf(WORLD_A, [], { current: 6, longest: 14, lastQualifiedDate: '2026-10-18' }),
            'week',
            null
        )
        expect(stats.today).toBe('2026-10-18')
        expect(stats.period).toEqual({ start: '2026-10-12', end: '2026-10-18' })
        expect(stats.days.map((one) => one.focusedSeconds / 60)).toEqual([0, 50, 40, 35, 60, 45, 45])
        expect(stats.days[0]).toEqual({ date: '2026-10-12', focusedSeconds: 0, roomSeconds: 0, soloSeconds: 0 })
        expect([stats.totalSeconds, stats.roomSeconds, stats.soloSeconds].map((seconds) => seconds / 60)).toEqual([
            275, 186, 89
        ])
        expect(stats.previousSeconds! / 60).toBe(115) // 275 - 115 = 2 giờ 40 phút
        expect(stats.previousPeriodSeconds! / 60).toBe(115)
        expect(Math.floor(stats.averageSeconds / 60)).toBe(39)
        expect(stats.streak).toEqual({ current: 6, longest: 14 })
        expect(stats.todaySeconds / 60).toBe(45)
        expect(stats.countedUntil).toBeNull()
        expect(stats.firstDate).toBe('2026-09-14')
    })

    it('gives where the count of the session one is in stands, read with today’s seconds, for the client to add what runs after it (D-231)', async () => {
        const countedUntil = new Date('2026-10-18T14:40:00.000Z')
        const stats = statsOf(WORLD_A, [], NO_STREAK, countedUntil)
        const shown = await run(stats, 'month', '2026-09-03')
        expect(stats.todayOf).toHaveBeenCalledWith('an', '2026-10-18')
        expect(shown.todaySeconds / 60).toBe(45)
        expect(shown.countedUntil).toEqual(countedUntil)
    })

    it('reads the day in the zone of one’s settings: An’s Sunday is still Saturday in UTC', async () => {
        jest.setSystemTime(new Date('2026-10-18T03:00:00.000Z')) // 10:00 in Hồ Chí Minh
        expect((await run(statsOf(WORLD_A), 'week', null, 'an')).today).toBe('2026-10-18')
        jest.setSystemTime(new Date('2026-10-17T20:00:00.000Z')) // 03:00 on Sunday there, Saturday in UTC
        expect((await run(statsOf(WORLD_A), 'week', null, 'an')).today).toBe('2026-10-18')
        expect((await run(statsOf(WORLD_A), 'week', null, 'binh')).today).toBe('2026-10-17') // no zone set: UTC
    })

    it('gives a week gone by of previous-week: all of it against all of the week before, its grid 14/09 – 11/10', async () => {
        const stats = await run(statsOf(WORLD_A), 'week', '2026-10-08')
        expect(stats.period).toEqual({ start: '2026-10-05', end: '2026-10-11' })
        expect(stats.totalSeconds / 60).toBe(115)
        expect(stats.previousSeconds! / 60).toBe(225) // −1 giờ 50 phút
        expect(Math.floor(stats.averageSeconds / 60)).toBe(16)
        expect(stats.grid!.map((one) => one.date)).toEqual(
            Array.from({ length: 28 }, (_, index) => addDays('2026-09-14', index))
        )
        expect(stats.grid![0]).toEqual({ date: '2026-09-14', focusedSeconds: 600 })
        expect(stats.grid![1]).toEqual({ date: '2026-09-15', focusedSeconds: 0 })
    })

    it('compares a month running with the same first days of the month before (+2 giờ 55 phút of month)', async () => {
        const october = [day('2026-10-01', 30), day('2026-10-02', 15), day('2026-10-03', 45), day('2026-10-04', 25)]
        const stats = await run(statsOf([...WORLD_A, ...october]), 'month', '2026-10-30')
        expect(stats.period).toEqual({ start: '2026-10-01', end: '2026-10-31' })
        expect(stats.days).toHaveLength(31)
        expect(stats.totalSeconds / 60).toBe(505)
        expect(Math.floor(stats.averageSeconds / 60)).toBe(28) // 505 / 18
        // 1–18/9 of world A: Monday to Friday of the week of 14/09, nothing before.
        expect(stats.previousSeconds! / 60).toBe(65)
        expect(stats.grid).toBeNull()
        expect(stats.bestOtherWeekSeconds).toBeNull()
    })

    it('hides the comparison of the first period with seconds, and says 0 for a period before with none', async () => {
        const first = await run(statsOf(WORLD_A), 'week', '2026-09-16')
        expect([first.previousSeconds, first.previousPeriodSeconds]).toEqual([null, null])
        const quiet = await run(statsOf([day('2026-09-01', 30), ...week('2026-10-12', [0, 50])]), 'week', null)
        expect([quiet.previousSeconds, quiet.previousPeriodSeconds]).toEqual([0, 0]) // "Tuần trước chưa học"
    })

    it('tells a week before studied only after the days compared from one not studied at all (D-230)', async () => {
        jest.setSystemTime(new Date('2026-10-14T05:00:00.000Z')) // Wednesday 12:00 in Hồ Chí Minh
        const stats = await run(
            statsOf([day('2026-09-01', 30), ...week('2026-10-05', [0, 0, 0, 0, 25, 0, 40])]),
            'week',
            null
        )
        expect(stats.previousSeconds).toBe(0) // Monday to Wednesday of last week
        expect(stats.previousPeriodSeconds! / 60).toBe(65) // so not "Tuần trước chưa học"
    })

    it('gives a new account nothing to page back to: the empty page', async () => {
        const stats = await run(statsOf([]), 'week', null)
        expect(stats.firstDate).toBeNull()
        expect(stats.totalSeconds).toBe(0)
        expect(stats.allTimeSeconds).toBe(0)
        expect(stats.previousSeconds).toBeNull()
        expect(stats.bestOtherWeekSeconds).toBeNull()
        expect(stats.streak).toEqual({ current: 0, longest: 0 })
    })

    it('shows a streak whose last day is before yesterday as 0, the longest kept', async () => {
        const stats = await run(
            statsOf(WORLD_A, [], { current: 6, longest: 14, lastQualifiedDate: '2026-10-16' }),
            'week',
            null
        )
        expect(stats.streak).toEqual({ current: 0, longest: 14 })
    })

    it('gives a period still ahead nothing, not an error, and nothing to compare', async () => {
        const stats = await run(statsOf(WORLD_A), 'week', '2026-11-02')
        expect(stats.totalSeconds).toBe(0)
        expect(stats.averageSeconds).toBe(0)
        expect(stats.previousSeconds).toBeNull()
        expect(stats.previousPeriodSeconds).toBeNull()
    })

    it('gives the best other week, so a week greater than all others is the best (week-spike, D-230)', async () => {
        const stats = await run(statsOf(WORLD_A), 'week', null)
        expect(stats.bestOtherWeekSeconds! / 60).toBe(270) // 21/09: 4 giờ 30 phút, below 275
        expect(stats.totalSeconds).toBeGreaterThan(stats.bestOtherWeekSeconds!)
        const earlier = await run(statsOf(WORLD_A), 'week', '2026-09-23')
        expect(earlier.bestOtherWeekSeconds! / 60).toBe(275) // later weeks count too
    })

    it('never gives the first week with seconds a best to beat', async () => {
        const stats = await run(statsOf(WORLD_A), 'week', '2026-09-14')
        expect(stats.bestOtherWeekSeconds).toBeNull()
    })
})

describe('ListStudySessionsHandler', () => {
    beforeEach(() => jest.useFakeTimers({ now: TODAY_2147 }))
    afterEach(() => jest.useRealTimers())

    const line = (sessionId: string, firstJoinedAt: string, shape: Partial<HistoryRow> = {}): HistoryRow => ({
        sessionId,
        kind: 'room',
        serverId: 'ot',
        channelId: 'phong-hoc',
        firstJoinedAt: new Date(firstJoinedAt),
        lastLeftAt: new Date(new Date(firstJoinedAt).getTime() + 3600_000),
        seconds: 1500,
        joinCount: 1,
        ...shape
    })

    const setup = (lines: HistoryRow[]) => {
        const world = studyWorld()
        const stats = statsOf([], lines)
        const handler = new ListStudySessionsHandler(stats, world.users, world.channels, world.checker)
        return {
            world,
            stats,
            list: (cursor: string | null = null, date: string | null = null, userId = 'an') =>
                handler.execute(new ListStudySessionsQuery(userId, 'week', date, cursor))
        }
    }

    it('puts the session one is in first, even with no second yet, then the latest first join first', async () => {
        const { list } = setup([
            line('s-1', '2026-10-13T13:00:00.000Z'),
            line('s-3', '2026-10-17T13:00:00.000Z'),
            line('s-2', '2026-10-15T13:30:00.000Z', { kind: 'solo', serverId: null, channelId: null }),
            line('s-now', '2026-10-18T07:00:00.000Z', { lastLeftAt: null, seconds: 0, joinCount: 2 })
        ])
        const page = await list()
        expect(page.items.map((item) => item.sessionId)).toEqual(['s-now', 's-3', 's-2', 's-1'])
        expect(page.items[0]).toMatchObject({ lastLeftAt: null, seconds: 0, joinCount: 2 })
        expect(page.hasMore).toBe(false)
    })

    it('takes a session into the period of the first join in one’s zone: 23:30 on Sunday is the week before', async () => {
        const { list } = setup([
            line('cn-khuya', '2026-10-11T16:30:00.000Z'), // CN 11/10 23:30 in Hồ Chí Minh
            line('t2-som', '2026-10-11T17:30:00.000Z') // T2 12/10 00:30
        ])
        expect((await list()).items.map((item) => item.sessionId)).toEqual(['t2-som'])
        expect((await list(null, '2026-10-05')).items.map((item) => item.sessionId)).toEqual(['cn-khuya'])
    })

    it('pages 20 lines at a time after the session named, the one one is in only on the first page', async () => {
        const lines = Array.from({ length: 25 }, (_, index) =>
            line(
                `s-${String(index).padStart(2, '0')}`,
                new Date(Date.parse('2026-10-12T01:00:00.000Z') + index * 3600_000).toISOString()
            )
        )
        const { list } = setup([...lines, line('s-now', '2026-10-18T07:00:00.000Z', { lastLeftAt: null })])
        const first = await list()
        expect(first.items).toHaveLength(21)
        expect(first.items[0].sessionId).toBe('s-now')
        expect(first.items[20].sessionId).toBe('s-05')
        expect(first.hasMore).toBe(true)
        const second = await list('s-05')
        expect(second.items.map((item) => item.sessionId)).toEqual(['s-04', 's-03', 's-02', 's-01', 's-00'])
        expect(second.hasMore).toBe(false)
    })

    it('says there is no more after exactly 20 lines', async () => {
        const lines = Array.from({ length: 20 }, (_, index) =>
            line(
                `s-${String(index).padStart(2, '0')}`,
                new Date(Date.parse('2026-10-12T01:00:00.000Z') + index * 3600_000).toISOString()
            )
        )
        const page = await setup(lines).list()
        expect([page.items.length, page.hasMore]).toEqual([20, false])
    })

    it('reads this week in one’s zone when no day is named: 00:30 on Monday there is next week', async () => {
        jest.setSystemTime(new Date('2026-10-18T17:30:00.000Z')) // Monday 19/10 00:30 in Hồ Chí Minh
        const { list } = setup([line('t2', '2026-10-18T17:10:00.000Z'), line('cn', '2026-10-18T16:50:00.000Z')])
        expect((await list()).items.map((item) => item.sessionId)).toEqual(['t2'])
    })

    it('refuses a cursor that is not one of one’s sessions: start again', async () => {
        const { list } = setup([line('s-1', '2026-10-13T13:00:00.000Z')])
        await expect(list('khong-co')).rejects.toBeInstanceOf(StaleStudyCursorError)
    })

    it('names each room as Bình may know it now, a member who does not see the private room (D-230)', async () => {
        const { list } = setup([
            line('xem-duoc', '2026-10-17T13:00:00.000Z'),
            line('da-xoa', '2026-10-16T13:00:00.000Z', { channelId: 'phong-cu' }),
            line('rieng-tu', '2026-10-15T13:00:00.000Z', { channelId: 'bi-mat' }),
            line('da-roi', '2026-10-14T13:00:00.000Z', { serverId: 'server-khac', channelId: 'phong-khac' }),
            line('mot-minh', '2026-10-13T13:00:00.000Z', { kind: 'solo', serverId: null, channelId: null })
        ])
        const places = (await list(null, null, 'binh')).items.map(
            ({ sessionId, roomName, roomDeleted, serverName }) => ({
                sessionId,
                roomName,
                roomDeleted,
                serverName
            })
        )
        expect(places).toEqual([
            {
                sessionId: 'xem-duoc',
                roomName: 'Phòng học im lặng',
                roomDeleted: false,
                serverName: 'Ôn thi Giải tích 2'
            },
            { sessionId: 'da-xoa', roomName: null, roomDeleted: true, serverName: 'Ôn thi Giải tích 2' },
            { sessionId: 'rieng-tu', roomName: null, roomDeleted: false, serverName: 'Ôn thi Giải tích 2' },
            { sessionId: 'da-roi', roomName: null, roomDeleted: false, serverName: null },
            { sessionId: 'mot-minh', roomName: null, roomDeleted: false, serverName: null }
        ])
    })

    it('names nothing of a server one is no longer in, the room still there or deleted (NFR-SEC-05)', async () => {
        const { list } = setup([
            line('con-phong', '2026-10-17T13:00:00.000Z'),
            line('phong-da-xoa', '2026-10-16T13:00:00.000Z', { channelId: 'phong-cu' })
        ])
        // Khách is no member of the server: as one who left it.
        const page = await list(null, null, 'khach')
        expect(page.items.map(({ roomName, roomDeleted, serverName }) => [roomName, roomDeleted, serverName])).toEqual([
            [null, false, null],
            [null, false, null]
        ])
    })

    it('names nothing when the server’s name is gone, even to one the cache still has as a member', async () => {
        const { list, world } = setup([line('xem-duoc', '2026-10-17T13:00:00.000Z')])
        ;(world.channels.namesOf as jest.Mock).mockResolvedValueOnce({
            servers: new Map(),
            channels: new Map([['phong-hoc', 'Phòng học im lặng']])
        })
        expect((await list(null, null, 'binh')).items[0]).toMatchObject({ roomName: null, serverName: null })
    })

    it('gives the session one was in once, first, when one left it between the two reads', async () => {
        const world = studyWorld()
        const now = line('s-now', '2026-10-18T07:00:00.000Z', { lastLeftAt: null })
        const stats = statsOf([], [now, line('s-1', '2026-10-13T13:00:00.000Z')])
        stats.linesOf.mockResolvedValueOnce([
            { ...now, lastLeftAt: new Date('2026-10-18T08:00:00.000Z') },
            line('s-1', '2026-10-13T13:00:00.000Z')
        ])
        const page = await new ListStudySessionsHandler(stats, world.users, world.channels, world.checker).execute(
            new ListStudySessionsQuery('an', 'week', null, null)
        )
        expect(page.items.map((item) => item.sessionId)).toEqual(['s-now', 's-1'])
    })

    it('shows the private room by name to one whose role sees it', async () => {
        const { list } = setup([line('rieng-tu', '2026-10-17T13:00:00.000Z', { channelId: 'bi-mat' })])
        expect((await list(null, null, 'chi')).items[0].roomName).toBe('Phòng bí mật')
    })

    it('reads the names once for the page', async () => {
        const { list, world } = setup([line('a', '2026-10-17T13:00:00.000Z'), line('b', '2026-10-16T13:00:00.000Z')])
        await list()
        expect(world.channels.namesOf).toHaveBeenCalledTimes(1)
        expect(world.channels.namesOf).toHaveBeenCalledWith(['ot'], ['phong-hoc', 'phong-hoc'])
    })
})
