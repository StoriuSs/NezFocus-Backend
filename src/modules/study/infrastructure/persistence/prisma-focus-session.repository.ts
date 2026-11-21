import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConcurrencyLimiter, ConcurrencyLimitError } from '@/shared/utils/concurrency-limiter.util'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    closesStretch,
    firstClock,
    FocusSession,
    FocusSessionActiveError,
    FocusSessionRepositoryPort,
    RoomSessionStart,
    SessionChange,
    SessionDecision,
    SessionSummary,
    StartedSession,
    StudyCount,
    StudyForbiddenError,
    StudyUnavailableError,
    wholeSecond,
    ZoneOf
} from '../../domain'
import { clockData, SESSION, toSession } from './focus-session.selections'
import { countParticipation, Tx } from './study-counts'
import { studyRoomLock } from './study-locks'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/**
 * How long one change of a session may hold its transaction: a count for
 * each person in it (about ten statements each), with room to spare. Past
 * it Prisma rolls back (P2028) and the command, job or sweep fails whole.
 */
const CHANGE_MS = 15_000

/**
 * A start holds a pool connection for the room's lock while it reads who is
 * in the room on another (voice's VOICE_ROOMS). As many at once as the pool
 * has connections would hold them all and wait on each other: at most a
 * third of the pool starts at a time, the rest queue, as voice's media turns
 * do (prisma-voice-state.repository.ts).
 */
const starters = (poolMax: number) =>
    new ConcurrencyLimiter({
        concurrency: Math.max(1, Math.floor(poolMax / 3)),
        maxQueued: 10_000,
        maxWaitMs: 2 * CHANGE_MS
    })

/** The later of the times given; the first when the rest are null. */
const latest = (first: Date, ...rest: (Date | null)[]): Date =>
    rest.reduce<Date>((max, time) => (time && time > max ? time : max), first)

/**
 * FocusSessionRepositoryPort on Postgres. The locks, in the order every
 * writer of the study tables takes them: the room (studyRoomLock, a start
 * and a join), the session row, then those of study-counts (D-224). Times
 * come from the app's clock, on a whole second, read once the locks are held.
 */
@Injectable()
export class PrismaFocusSessionRepository implements FocusSessionRepositoryPort {
    private readonly starters: ConcurrencyLimiter

    constructor(
        private readonly prisma: PrismaService,
        config: ConfigService
    ) {
        this.starters = starters(config.get<number>('database.poolMax') ?? 10)
    }

    async find(sessionId: string): Promise<FocusSession | null> {
        const row = await this.prisma.focusSession.findUnique({ where: { id: sessionId }, select: SESSION })
        return row && toSession(row)
    }

    async openInRooms(channelIds: string[]): Promise<Map<string, FocusSession>> {
        if (channelIds.length === 0) return new Map()
        // `<> 'ended'`, as FocusSession_one_open_per_room is written: so that index is used.
        const rows = await this.prisma.focusSession.findMany({
            where: { channelId: { in: channelIds }, status: { not: 'ended' } },
            select: SESSION
        })
        return new Map(rows.map((row) => [row.channelId!, toSession(row)]))
    }

    async startInRoom(start: RoomSessionStart, peopleIn: () => Promise<string[]>): Promise<StartedSession> {
        try {
            return await this.starters.run(() => this.startOnce(start, peopleIn))
        } catch (error) {
            if (error instanceof ConcurrencyLimitError) throw new StudyUnavailableError()
            // FocusSession_one_open_per_room: the room has one already.
            if (prismaCode(error) === 'P2002') throw new FocusSessionActiveError(`room ${start.channelId}`)
            throw error
        }
    }

    private startOnce(
        { serverId, channelId, hostId, cycle, minuteMs }: RoomSessionStart,
        peopleIn: () => Promise<string[]>
    ): Promise<StartedSession> {
        return this.prisma.$transaction(
            async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${studyRoomLock(channelId)}, 0))`
                const at = wholeSecond(new Date())
                const row = await tx.focusSession.create({
                    data: {
                        kind: 'room',
                        serverId,
                        channelId,
                        hostId,
                        ...cycle,
                        ...clockData(firstClock(cycle, at, minuteMs)),
                        startedAt: at
                    },
                    select: { id: true }
                })
                await tx.focusStretch.create({ data: { sessionId: row.id, startedAt: at } })
                const people = [...new Set(await peopleIn())].sort()
                // Someone with a participation open elsewhere meets Participation_one_open_per_person, and is skipped.
                await tx.participation.createMany({
                    data: people.map((userId) => ({ sessionId: row.id, userId, joinedAt: at, countedUntil: at })),
                    skipDuplicates: true
                })
                const joined = (
                    await tx.participation.findMany({
                        where: { sessionId: row.id },
                        select: { userId: true },
                        orderBy: { userId: 'asc' }
                    })
                ).map(({ userId }) => userId)
                // Its Host takes part, or there is no session: one who left the room since the check, or
                // is still in another session (D-222; a Solo yields first from M5 L4), rolls it back.
                if (!joined.includes(hostId)) {
                    throw people.includes(hostId)
                        ? new FocusSessionActiveError(`person ${hostId}`)
                        : new StudyForbiddenError('not_in_room')
                }
                const session = await tx.focusSession.findUniqueOrThrow({ where: { id: row.id }, select: SESSION })
                return { session: toSession(session), participantIds: joined }
            },
            { timeout: CHANGE_MS, maxWait: CHANGE_MS }
        )
    }

    async change(
        sessionId: string,
        version: number | null,
        decide: SessionDecision,
        zoneOf: ZoneOf
    ): Promise<SessionChange | null> {
        // Each person's zone read before the transaction: none of its locks waits on another connection.
        const zones = await zonesOf(this.prisma, sessionId, zoneOf)
        return this.prisma.$transaction(
            async (tx) => {
                const [locked] = await tx.$queryRaw<{ id: string }[]>`
                    SELECT "id" FROM "FocusSession" WHERE "id" = ${sessionId} FOR UPDATE
                `
                if (!locked) return null
                const before = toSession(
                    await tx.focusSession.findUniqueOrThrow({ where: { id: sessionId }, select: SESSION })
                )
                // Never before what is written already: another instance's clock may be a little ahead.
                const at = latest(wholeSecond(new Date()), before.phaseStartedAt, before.stretchStartedAt)
                const move = version !== null && version !== before.version ? null : decide(before, at)
                if (!move) return { before, after: before, changed: false, counts: [], summaries: null }

                for (const stretch of move.stretches) {
                    if ('close' in stretch) {
                        await tx.focusStretch.updateMany({
                            where: { sessionId, endedAt: null },
                            data: { endedAt: stretch.close }
                        })
                    } else {
                        await tx.focusStretch.create({ data: { sessionId, startedAt: stretch.open } })
                    }
                }
                const row = await tx.focusSession.update({
                    where: { id: sessionId },
                    data: { ...move.cycle, ...clockData(move.clock), version: before.version + 1 },
                    select: SESSION
                })

                const ended = move.clock.status === 'ended'
                const counts: StudyCount[] = []
                if (closesStretch(move) || ended) {
                    const open = await tx.participation.findMany({
                        where: { sessionId, leftAt: null },
                        select: { id: true, userId: true },
                        orderBy: { userId: 'asc' }
                    })
                    for (const { id, userId } of open) {
                        // One who joined since the zones were read (M5 L3b) is read now.
                        const zone = zones.get(userId) ?? (await zoneOf(userId))
                        const count = await countParticipation(tx, id, zone, () => move.at)
                        if (count) counts.push(count)
                    }
                }
                if (ended) await leaveAll(tx, sessionId, move.at)
                return {
                    before,
                    after: toSession(row),
                    changed: true,
                    counts,
                    summaries: ended ? await summariesOf(tx, sessionId) : null
                }
            },
            { timeout: CHANGE_MS, maxWait: CHANGE_MS }
        )
    }

    async overdue(now: Date, limit: number): Promise<{ id: string; version: number }[]> {
        // On FocusSession_running_due: only the running sessions, the earliest due first.
        return this.prisma.focusSession.findMany({
            where: { status: 'running', phaseEndsAt: { lte: now } },
            select: { id: true, version: true },
            orderBy: { phaseEndsAt: 'asc' },
            take: limit
        })
    }
}

/** The zone of each person with an open participation in the session now. */
async function zonesOf(prisma: PrismaService, sessionId: string, zoneOf: ZoneOf): Promise<Map<string, string>> {
    const open = await prisma.participation.findMany({ where: { sessionId, leftAt: null }, select: { userId: true } })
    return new Map(await Promise.all(open.map(async ({ userId }) => [userId, await zoneOf(userId)] as const)))
}

/**
 * Closes every open participation of an ended session at `at`, or at the time
 * its person went away if away (D-215: the time away counts only once back);
 * never before what is counted already (Participation_time_check). Each was
 * counted up to there just before.
 */
async function leaveAll(tx: Tx, sessionId: string, at: Date): Promise<void> {
    await tx.$executeRaw`
        UPDATE "Participation"
        SET "leftAt" = GREATEST(COALESCE("awaySince", ${at}), "countedUntil"), "awaySince" = NULL
        WHERE "sessionId" = ${sessionId} AND "leftAt" IS NULL
    `
}

/** Every participant's seconds in the session, all their stays added up (D-49). */
async function summariesOf(tx: Tx, sessionId: string): Promise<SessionSummary[]> {
    const rows = await tx.participation.groupBy({
        by: ['userId'],
        where: { sessionId },
        _sum: { seconds: true },
        orderBy: { userId: 'asc' }
    })
    return rows.map((row) => ({ userId: row.userId, seconds: row._sum.seconds ?? 0 }))
}
