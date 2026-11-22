import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    applyCount,
    countedUntilAfter,
    countLimit,
    LocalDate,
    localDateOf,
    newSeconds,
    NO_STREAK,
    shownStreak,
    StreakState,
    StudyCount,
    wholeSecond
} from '../../domain'

/** The client a Prisma transaction callback is given. */
export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

/** A day as a `@db.Date` column takes it: its midnight in UTC, which Postgres keeps as that date. */
export const toDateColumn = (date: LocalDate): Date => new Date(`${date}T00:00:00.000Z`)

/** A `@db.Date` column back as YYYY-MM-DD (Prisma gives its midnight in UTC). */
export const fromDateColumn = (column: Date): LocalDate => column.toISOString().slice(0, 10)

/**
 * One count (chốt) of a participation in the open transaction `tx`
 * (ARCHITECTURE 5.2, D-224): the seconds since its countedUntil go to the
 * person's days in `timeZone` (room or Solo seconds, by the session's kind),
 * the 16-hour cap applied, the participation's seconds go up by as much,
 * countedUntil moves on (not past the due end of the running phase, focus
 * or break, never back), and the streak moves for each day
 * reaching 15 minutes. Null when there is no such participation. The caller
 * publishes StudyCountedEvent with the result once its transaction commits
 * (`streak.updated`).
 *
 * The locks, in the order every writer of the study tables takes them, so
 * none waits on another in turn: the session, the participation, the days
 * written by date, the streak. A day or streak row not there yet is made
 * first (empty, ON CONFLICT DO NOTHING): FOR UPDATE locks no row that does
 * not exist, and two counts at once would both read 0 and both miss the
 * 15 minutes. `now` is read once the participation is locked, so a count
 * that waited counts up to when it ran.
 */
export async function countParticipation(
    tx: Tx,
    participationId: string,
    timeZone: string,
    now: () => Date
): Promise<StudyCount | null> {
    const [session] = await tx.$queryRaw<
        { id: string; kind: 'room' | 'solo'; status: string; phase: string; phaseEndsAt: Date | null }[]
    >`
        SELECT s."id", s."kind"::text AS "kind", s."status"::text AS "status", s."phase"::text AS "phase", s."phaseEndsAt"
        FROM "FocusSession" s
        WHERE s."id" = (SELECT p."sessionId" FROM "Participation" p WHERE p."id" = ${participationId})
        FOR UPDATE
    `
    if (!session) return null
    const [participation] = await tx.$queryRaw<
        {
            userId: string
            leftAt: Date | null
            awaySince: Date | null
            countedUntil: Date
            seconds: number
        }[]
    >`
        SELECT "userId", "leftAt", "awaySince", "countedUntil", "seconds"
        FROM "Participation" WHERE "id" = ${participationId}
        FOR UPDATE
    `
    if (!participation) return null
    const { userId } = participation

    const at = wholeSecond(now())
    const from = participation.countedUntil
    const until = countLimit(participation, at)
    const stretches = await tx.focusStretch.findMany({
        where: { sessionId: session.id, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
        select: { startedAt: true, endedAt: true }
    })
    // While a phase runs, the end it is due: a focus stretch counts no further, and countedUntil goes no
    // further either, focus or break: the late job opens the next stretch there, and what is after it is
    // looked at again then.
    const dueEnd = session.status === 'running' ? session.phaseEndsAt : null
    const focusEndsAt = session.phase === 'focus' ? dueEnd : null
    const found = newSeconds({ from, until, stretches, focusEndsAt, timeZone })

    const today = localDateOf(at, timeZone)
    let streak: StreakState
    let added = 0
    const dayHas = new Map<LocalDate, number>()
    if (found.length > 0) {
        const dates = found.map((day) => day.date)
        await tx.dailyStudy.createMany({
            data: dates.map((date) => ({ userId, localDate: toDateColumn(date) })),
            skipDuplicates: true
        })
        const days = await tx.$queryRaw<{ localDate: Date; focusedSeconds: number }[]>`
            SELECT "localDate", "focusedSeconds" FROM "DailyStudy"
            WHERE "userId" = ${userId} AND "localDate" = ANY(${dates}::date[])
            ORDER BY "localDate"
            FOR UPDATE
        `
        for (const day of days) dayHas.set(fromDateColumn(day.localDate), day.focusedSeconds)
        await tx.streak.createMany({ data: [{ userId }], skipDuplicates: true })
        const before = await lockedStreak(tx, userId)

        const result = applyCount(found, dayHas, before)
        const column = session.kind === 'room' ? 'roomSeconds' : 'soloSeconds'
        for (const day of result.days) {
            await tx.dailyStudy.update({
                where: { userId_localDate: { userId, localDate: toDateColumn(day.date) } },
                data: { focusedSeconds: { increment: day.seconds }, [column]: { increment: day.seconds } }
            })
            dayHas.set(day.date, (dayHas.get(day.date) ?? 0) + day.seconds)
        }
        if (result.streakMoved) {
            const { current, longest, lastQualifiedDate } = result.streak
            await tx.streak.update({
                where: { userId },
                data: { current, longest, lastQualifiedDate: lastQualifiedDate && toDateColumn(lastQualifiedDate) }
            })
        }
        streak = result.streak
        added = result.seconds
    } else {
        streak = await readStreak(tx, userId)
    }

    const countedUntil = countedUntilAfter({ from, until, focusEndsAt: dueEnd })
    await tx.participation.update({
        where: { id: participationId },
        data: { countedUntil, seconds: { increment: added } }
    })
    const todaySeconds = dayHas.get(today) ?? (await readDay(tx, userId, today))
    return {
        userId,
        sessionId: session.id,
        added,
        seconds: participation.seconds + added,
        countedUntil,
        todaySeconds,
        streak,
        shownStreak: shownStreak(streak, today)
    }
}

type StreakRow = { current: number; longest: number; lastQualifiedDate: Date | null }

const toStreak = (row: StreakRow | null | undefined): StreakState =>
    row
        ? {
              current: row.current,
              longest: row.longest,
              lastQualifiedDate: row.lastQualifiedDate && fromDateColumn(row.lastQualifiedDate)
          }
        : NO_STREAK

async function lockedStreak(tx: Tx, userId: string): Promise<StreakState> {
    const [row] = await tx.$queryRaw<StreakRow[]>`
        SELECT "current", "longest", "lastQualifiedDate" FROM "Streak" WHERE "userId" = ${userId}
        FOR UPDATE
    `
    return toStreak(row)
}

/** The streak as stored, read without a lock: in a count, or for the Stats page. */
export const readStreak = async (tx: Tx | PrismaService, userId: string): Promise<StreakState> =>
    toStreak(
        await tx.streak.findUnique({
            where: { userId },
            select: { current: true, longest: true, lastQualifiedDate: true }
        })
    )

const readDay = async (tx: Tx, userId: string, date: LocalDate): Promise<number> =>
    (
        await tx.dailyStudy.findUnique({
            where: { userId_localDate: { userId, localDate: toDateColumn(date) } },
            select: { focusedSeconds: true }
        })
    )?.focusedSeconds ?? 0
