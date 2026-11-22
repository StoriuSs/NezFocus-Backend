import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    DayStudy,
    HistoryCursor,
    HistoryRow,
    HistoryWindow,
    LocalDate,
    SessionKind,
    StreakState,
    StudyLifetime,
    StudyStatsRepositoryPort,
    StudyToday
} from '../../domain'
import { fromDateColumn, readStreak, toDateColumn } from './study-counts'

type LineRow = {
    sessionId: string
    kind: SessionKind
    serverId: string | null
    channelId: string | null
    firstJoinedAt: Date
    lastLeftAt: Date | null
    seconds: number
    joinCount: number
}

/**
 * The Stats page's reads (D-104, D-105, D-230), from DailyStudy and Streak,
 * and from Participation for the history: a person's participations by
 * (userId, joinedAt), a session's by sessionId, the one they are in by
 * Participation_one_open_per_person.
 */
@Injectable()
export class PrismaStudyStatsRepository implements StudyStatsRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async daysOf(userId: string, from: LocalDate, to: LocalDate): Promise<DayStudy[]> {
        const rows = await this.prisma.dailyStudy.findMany({
            where: { userId, localDate: { gte: toDateColumn(from), lte: toDateColumn(to) } },
            select: { localDate: true, focusedSeconds: true, roomSeconds: true, soloSeconds: true },
            orderBy: { localDate: 'asc' }
        })
        return rows.map(({ localDate, ...seconds }) => ({ date: fromDateColumn(localDate), ...seconds }))
    }

    async todayOf(userId: string, today: LocalDate): Promise<StudyToday> {
        // One statement reads one snapshot, and a count writes DailyStudy and
        // countedUntil in one transaction: the two numbers belong to the same count.
        const [row] = await this.prisma.$queryRaw<{ seconds: number; countedUntil: Date | null }[]>`
            SELECT coalesce((
                       SELECT "focusedSeconds" FROM "DailyStudy"
                       WHERE "userId" = ${userId} AND "localDate" = ${today}::date
                   ), 0)::int AS "seconds",
                   (
                       SELECT "countedUntil" FROM "Participation"
                       WHERE "userId" = ${userId} AND "leftAt" IS NULL
                   ) AS "countedUntil"
        `
        return row
    }

    async secondsBetween(userId: string, from: LocalDate, to: LocalDate): Promise<number> {
        const { _sum } = await this.prisma.dailyStudy.aggregate({
            where: { userId, localDate: { gte: toDateColumn(from), lte: toDateColumn(to) } },
            _sum: { focusedSeconds: true }
        })
        return _sum.focusedSeconds ?? 0
    }

    async lifetimeOf(userId: string): Promise<StudyLifetime> {
        const [row] = await this.prisma.$queryRaw<{ total: bigint; first: Date | null }[]>`
            SELECT coalesce(sum("focusedSeconds"), 0)::int8 AS "total",
                   min("localDate") FILTER (WHERE "focusedSeconds" > 0) AS "first"
            FROM "DailyStudy" WHERE "userId" = ${userId}
        `
        return { totalSeconds: Number(row.total), firstDate: row.first && fromDateColumn(row.first) }
    }

    async bestWeekExcept(userId: string, weekStart: LocalDate): Promise<number | null> {
        // date_trunc('week') starts weeks on Monday (ISO), like the page's; on a
        // timestamp without zone, so the database session's TimeZone plays no part.
        const [row] = await this.prisma.$queryRaw<{ best: number | null }[]>`
            SELECT max("total")::int AS "best" FROM (
                SELECT date_trunc('week', "localDate"::timestamp)::date AS "week", sum("focusedSeconds") AS "total"
                FROM "DailyStudy" WHERE "userId" = ${userId}
                GROUP BY 1
            ) AS "weeks"
            WHERE "week" <> ${weekStart}::date AND "total" > 0
        `
        return row.best
    }

    streakOf(userId: string): Promise<StreakState> {
        return readStreak(this.prisma, userId)
    }

    async openLineOf(userId: string, window: HistoryWindow): Promise<HistoryRow | null> {
        const [row] = await this.prisma.$queryRaw<LineRow[]>`
            SELECT q."sessionId", s."kind"::text AS "kind", s."serverId", s."channelId",
                   min(q."joinedAt") AS "firstJoinedAt", NULL::timestamptz AS "lastLeftAt",
                   sum(q."seconds")::int AS "seconds", count(*)::int AS "joinCount"
            FROM "Participation" q
            JOIN "FocusSession" s ON s."id" = q."sessionId"
            WHERE q."userId" = ${userId}
              AND q."sessionId" = (
                  SELECT "sessionId" FROM "Participation" WHERE "userId" = ${userId} AND "leftAt" IS NULL
              )
            GROUP BY q."sessionId", s."kind", s."serverId", s."channelId"
            HAVING min(q."joinedAt") >= ${window.from} AND min(q."joinedAt") < ${window.to}
        `
        return row ?? null
    }

    linesOf(userId: string, window: HistoryWindow, cursor: HistoryCursor | null, limit: number): Promise<HistoryRow[]> {
        const after = cursor
            ? Prisma.sql`AND (l."firstJoinedAt", l."sessionId") < (${cursor.firstJoinedAt}, ${cursor.sessionId})`
            : Prisma.empty
        // The sessions with a join in the window, then all their joins: one
        // whose first join is before the window belongs to an earlier period.
        return this.prisma.$queryRaw<LineRow[]>`
            WITH "joined" AS (
                SELECT DISTINCT "sessionId" FROM "Participation"
                WHERE "userId" = ${userId} AND "joinedAt" >= ${window.from} AND "joinedAt" < ${window.to}
            ), "lines" AS (
                SELECT q."sessionId", min(q."joinedAt") AS "firstJoinedAt", max(q."leftAt") AS "lastLeftAt",
                       sum(q."seconds")::int AS "seconds", count(*)::int AS "joinCount",
                       bool_or(q."leftAt" IS NULL) AS "open"
                FROM "joined" j
                JOIN "Participation" q ON q."sessionId" = j."sessionId" AND q."userId" = ${userId}
                GROUP BY q."sessionId"
            )
            SELECT l."sessionId", s."kind"::text AS "kind", s."serverId", s."channelId",
                   l."firstJoinedAt", l."lastLeftAt", l."seconds", l."joinCount"
            FROM "lines" l
            JOIN "FocusSession" s ON s."id" = l."sessionId"
            WHERE l."firstJoinedAt" >= ${window.from} AND NOT l."open" AND l."seconds" > 0 ${after}
            ORDER BY l."firstJoinedAt" DESC, l."sessionId" DESC
            LIMIT ${limit}
        `
    }

    async firstJoinOf(userId: string, sessionId: string): Promise<Date | null> {
        const { _min } = await this.prisma.participation.aggregate({
            where: { userId, sessionId },
            _min: { joinedAt: true }
        })
        return _min.joinedAt
    }
}
