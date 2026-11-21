import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@/generated/prisma/client'
import { ConcurrencyLimiter, ConcurrencyLimitError } from '@/shared/utils/concurrency-limiter.util'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    closesStretch,
    firstClock,
    FocusSession,
    FocusSessionActiveError,
    FocusSessionRepositoryPort,
    joinMove,
    JoinOutcome,
    LeaveFrom,
    MayHost,
    OpenRoom,
    Place,
    PresenceChange,
    presenceMove,
    Present,
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
import { lockStudyRoom } from './study-locks'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/**
 * How long one change of a session may hold its transaction: a count for
 * each person in it (about ten statements each), with room to spare. Past
 * it Prisma rolls back (P2028) and the command, job or sweep fails whole.
 */
const CHANGE_MS = 15_000

/**
 * How many times a change runs at most to read what it found missing once
 * locked (the zone of one who joined meanwhile, whether one may be Host)
 * outside the transaction, so that no lock waits on another connection.
 * Past it, the last run reads a missing zone inside, and takes one not asked
 * about as not able to be Host.
 */
const READ_RUNS = 3

/**
 * Every transaction that takes a room's lock holds a pool connection while
 * it waits for it, and a start, holding it, reads who is in the room on
 * another connection (voice's VOICE_ROOMS). As many of them as the pool has
 * connections (a class coming in as the Host presses Bắt đầu) would leave the
 * start none: at most a third of the pool runs them at a time, the rest
 * queue, as voice's media turns do (prisma-voice-state.repository.ts).
 */
const roomLocks = (poolMax: number) =>
    new ConcurrencyLimiter({
        concurrency: Math.max(1, Math.floor(poolMax / 3)),
        maxQueued: 10_000,
        maxWaitMs: 2 * CHANGE_MS
    })

/** The later of the times given; the first when the rest are null. */
const latest = (first: Date, ...rest: (Date | null)[]): Date =>
    rest.reduce<Date>((max, time) => (time && time > max ? time : max), first)

/** What happens to a participation once locked: away from now, gone (counted and closed), or nothing. */
type PresenceStep = (place: Place) => 'away' | 'leave' | null

/** Finds, under the room's lock, the participation a change of presence is about; null when there is none. */
type Locate = (tx: Tx) => Promise<string | null>

/**
 * FocusSessionRepositoryPort on Postgres. The locks, in the order every
 * writer of the study tables takes them: the room (studyRoomLock: a start, a
 * join, a leaving), the session row, then those of study-counts (D-224).
 * Times come from the app's clock, on a whole second, read once the locks
 * are held. What to write is decided by the rules of the domain on the rows
 * as they are once locked.
 */
@Injectable()
export class PrismaFocusSessionRepository implements FocusSessionRepositoryPort {
    private readonly roomLocks: ConcurrencyLimiter

    constructor(
        private readonly prisma: PrismaService,
        config: ConfigService
    ) {
        this.roomLocks = roomLocks(config.get<number>('database.poolMax') ?? 10)
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

    async openInServer(serverId: string): Promise<FocusSession[]> {
        // On FocusSession_open_by_server.
        const rows = await this.prisma.focusSession.findMany({
            where: { serverId, status: { not: 'ended' } },
            select: SESSION
        })
        return rows.map(toSession)
    }

    async startInRoom(start: RoomSessionStart, peopleIn: () => Promise<string[]>): Promise<StartedSession> {
        try {
            return await this.inRoomLock(() => this.startOnce(start, peopleIn))
        } catch (error) {
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
                await lockStudyRoom(tx, channelId)
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
        const zones = new Map<string, string>()
        for (const userId of await countedIn(this.prisma, sessionId)) zones.set(userId, await zoneOf(userId))
        for (let run = 1; ; run++) {
            const result = await this.prisma.$transaction(
                (tx) => changeOnce(tx, sessionId, version, decide, zones, run >= READ_RUNS ? zoneOf : null),
                { timeout: CHANGE_MS, maxWait: CHANGE_MS }
            )
            if (!(result && 'zonesFor' in result)) return result
            // Someone joined since the zones were read: read theirs, and run again.
            for (const userId of result.zonesFor) zones.set(userId, await zoneOf(userId))
        }
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

    async joinRoom(channelId: string, userId: string, mayHost: boolean | null): Promise<JoinOutcome> {
        return this.inRoomLock(() =>
            this.prisma.$transaction((tx) => joinOnce(tx, channelId, userId, mayHost), {
                timeout: CHANGE_MS,
                maxWait: CHANGE_MS
            })
        )
    }

    async leave(
        from: LeaveFrom,
        userId: string,
        lost: boolean,
        mayHost: MayHost,
        zoneOf: ZoneOf
    ): Promise<PresenceChange | null> {
        if ('anyRoom' in from) {
            // The room of the place they have now, if any; looked up again under its lock.
            const open = await this.prisma.participation.findFirst({
                where: { userId, leftAt: null, session: { kind: 'room', status: { not: 'ended' } } },
                select: { session: { select: { channelId: true } } }
            })
            if (!open) return null
            return this.leave({ channelId: open.session.channelId! }, userId, lost, mayHost, zoneOf)
        }
        // The room whose lock to take: a session's room never changes. A Solo has none.
        const channelId =
            'channelId' in from
                ? from.channelId
                : ((
                      await this.prisma.focusSession.findUnique({
                          where: { id: from.sessionId },
                          select: { channelId: true }
                      })
                  )?.channelId ?? null)
        const where =
            'channelId' in from ? Prisma.sql`s."channelId" = ${from.channelId}` : Prisma.sql`s."id" = ${from.sessionId}`
        // Looked up under the room's lock: one a start or a join is writing now is found once it commits.
        const locate: Locate = async (tx) => {
            const [found] = await tx.$queryRaw<{ id: string }[]>`
                SELECT p."id" FROM "Participation" p JOIN "FocusSession" s ON s."id" = p."sessionId"
                WHERE p."userId" = ${userId} AND p."leftAt" IS NULL AND s."status" <> 'ended' AND ${where}
            `
            return found?.id ?? null
        }
        // Lost while away already: still away since then. Else away from now, or gone.
        return this.changePresence(channelId, userId, mayHost, zoneOf, locate, (place) =>
            lost ? (place.awaySince ? null : 'away') : 'leave'
        )
    }

    async closeAway(
        participationId: string,
        since: Date,
        mayHost: MayHost,
        zoneOf: ZoneOf
    ): Promise<PresenceChange | null> {
        const read = await this.prisma.participation.findUnique({
            where: { id: participationId },
            select: { userId: true, session: { select: { channelId: true } } }
        })
        if (!read) return null
        return this.changePresence(
            read.session.channelId,
            read.userId,
            mayHost,
            zoneOf,
            async () => participationId,
            (place) => (place.awaySince?.getTime() === since.getTime() ? 'leave' : null)
        )
    }

    async emptySince(before: Date, limit: number): Promise<{ id: string; emptySince: Date }[]> {
        // On FocusSession_empty_due; an ended session has none (FocusSession_empty_check).
        const rows = await this.prisma.focusSession.findMany({
            where: { emptySince: { lte: before } },
            select: { id: true, emptySince: true },
            orderBy: { emptySince: 'asc' },
            take: limit
        })
        return rows.map((row) => ({ id: row.id, emptySince: row.emptySince! }))
    }

    async awaySince(before: Date, limit: number): Promise<{ id: string; awaySince: Date }[]> {
        // On Participation_away_due; away only while open (Participation_time_check).
        const rows = await this.prisma.participation.findMany({
            where: { awaySince: { lte: before } },
            select: { id: true, awaySince: true },
            orderBy: { awaySince: 'asc' },
            take: limit
        })
        return rows.map((row) => ({ id: row.id, awaySince: row.awaySince! }))
    }

    async openRooms(): Promise<OpenRoom[]> {
        // On FocusSession_one_open_per_room's condition: the sessions not ended, one per room at most.
        const rows = await this.prisma.focusSession.findMany({
            where: { kind: 'room', status: { not: 'ended' } },
            select: {
                id: true,
                channelId: true,
                participations: {
                    where: { leftAt: null, awaySince: null },
                    select: { userId: true },
                    orderBy: { userId: 'asc' }
                }
            },
            orderBy: { startedAt: 'asc' }
        })
        return rows.map((row) => ({
            sessionId: row.id,
            channelId: row.channelId!,
            present: row.participations.map(({ userId }) => userId)
        }))
    }

    /** Runs `work`, a transaction taking a room's lock, within roomLocks: SERVICE_UNAVAILABLE past its wait. */
    private async inRoomLock<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await this.roomLocks.run(work)
        } catch (error) {
            if (error instanceof ConcurrencyLimitError) throw new StudyUnavailableError()
            throw error
        }
    }

    /**
     * One person away or gone from a session (presenceMove), as `step`
     * decides on their participation once locked. A Host gone hands over
     * (nextHost): who may be Host is asked outside the transaction, so when
     * someone present was not asked about yet, nothing is written, they are
     * asked, and it runs again (READ_RUNS).
     */
    private async changePresence(
        channelId: string | null,
        userId: string,
        mayHost: MayHost,
        zoneOf: ZoneOf,
        locate: Locate,
        step: PresenceStep
    ): Promise<PresenceChange | null> {
        const zone = await zoneOf(userId)
        const asked = new Map<string, boolean>()
        for (let run = 1; ; run++) {
            const result = await this.inRoomLock(() =>
                this.prisma.$transaction(
                    (tx) => presenceOnce(tx, channelId, locate, zone, asked, run >= READ_RUNS, step),
                    { timeout: CHANGE_MS, maxWait: CHANGE_MS }
                )
            )
            if (!('ask' in result)) return result.change
            // Only a Room Session has a Host, so a room.
            for (const id of result.ask) asked.set(id, await mayHost(channelId!, id))
        }
    }
}

/**
 * One run of PrismaFocusSessionRepository.change in `tx`: the change, or the
 * people whose zone is missing, before anything is written. `zoneOf` is
 * given on the last run only, to read a missing zone inside.
 */
async function changeOnce(
    tx: Tx,
    sessionId: string,
    version: number | null,
    decide: SessionDecision,
    zones: ReadonlyMap<string, string>,
    zoneOf: ZoneOf | null
): Promise<SessionChange | { zonesFor: string[] } | null> {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "FocusSession" WHERE "id" = ${sessionId} FOR UPDATE
    `
    if (!locked) return null
    const before = toSession(await tx.focusSession.findUniqueOrThrow({ where: { id: sessionId }, select: SESSION }))
    // Never before what is written already: another instance's clock may be a little ahead.
    const at = latest(wholeSecond(new Date()), before.phaseStartedAt, before.stretchStartedAt)
    const move = version !== null && version !== before.version ? null : decide(before, at)
    if (!move) return { before, after: before, changed: false, counts: [], summaries: null }

    const ended = move.clock.status === 'ended'
    const counted = closesStretch(move) || ended ? await toCount(tx, sessionId) : []
    const missing = [...new Set(counted.map(({ userId }) => userId).filter((userId) => !zones.has(userId)))]
    if (missing.length > 0 && !zoneOf) return { zonesFor: missing }

    for (const stretch of move.stretches) {
        if ('close' in stretch) {
            await tx.focusStretch.updateMany({ where: { sessionId, endedAt: null }, data: { endedAt: stretch.close } })
        } else {
            await tx.focusStretch.create({ data: { sessionId, startedAt: stretch.open } })
        }
    }
    const row = await tx.focusSession.update({
        where: { id: sessionId },
        // An ended session is empty of nothing (FocusSession_empty_check).
        data: {
            ...move.cycle,
            ...clockData(move.clock),
            ...(ended && { emptySince: null }),
            version: before.version + 1
        },
        select: SESSION
    })

    const counts: StudyCount[] = []
    for (const { id, userId } of counted) {
        const zone = zones.get(userId) ?? (await zoneOf!(userId))
        const count = await countParticipation(tx, id, zone, () => move.at)
        if (count) counts.push(count)
    }
    if (ended) await leaveAll(tx, sessionId, move.at)
    return {
        before,
        after: toSession(row),
        changed: true,
        counts,
        summaries: ended ? await summariesOf(tx, sessionId) : null
    }
}

/**
 * One run of PrismaFocusSessionRepository.joinRoom in `tx`, decided by
 * joinMove on the rows once locked: the room, then its session.
 */
async function joinOnce(tx: Tx, channelId: string, userId: string, mayHost: boolean | null): Promise<JoinOutcome> {
    await lockStudyRoom(tx, channelId)
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "FocusSession" WHERE "channelId" = ${channelId} AND "status" <> 'ended' FOR UPDATE
    `
    // One open at most (Participation_one_open_per_person).
    const open = await tx.participation.findFirst({
        where: { userId, leftAt: null },
        select: { id: true, sessionId: true, awaySince: true, session: { select: { kind: true } } }
    })
    // Another room's place closes on coming into any room (D-215); a Solo only yields to a
    // Room Session (D-103, M5 L4).
    if (open && open.sessionId !== locked?.id && (locked || open.session.kind === 'room')) {
        return { kind: 'elsewhere', sessionId: open.sessionId }
    }
    if (!locked) return { kind: 'no_session' }
    const before = toSession(await tx.focusSession.findUniqueOrThrow({ where: { id: locked.id }, select: SESSION }))
    const move = joinMove(before, open, mayHost)
    if (move === 'ask') return { kind: 'ask' }

    const at = latest(wholeSecond(new Date()), before.phaseStartedAt, before.stretchStartedAt)
    if (move.opens) {
        await tx.participation.create({ data: { sessionId: before.id, userId, joinedAt: at, countedUntil: at } })
    } else if (move.back) {
        // The next count runs on from where it stopped, the time away in it (D-215).
        await tx.participation.update({ where: { id: open!.id }, data: { awaySince: null } })
    }
    const data = {
        ...(move.endsEmptiness && { emptySince: null }),
        ...(move.becomesHost && { hostId: userId, version: before.version + 1 })
    }
    const after =
        Object.keys(data).length > 0
            ? toSession(await tx.focusSession.update({ where: { id: before.id }, data, select: SESSION }))
            : before
    return {
        kind: 'joined',
        change: {
            before,
            after,
            changed: move.becomesHost,
            counts: [],
            summaries: null,
            away: null,
            emptySince: null
        }
    }
}

/**
 * One run of changePresence in `tx`, decided by presenceMove on the rows once
 * locked: the room (none for a Solo), then the session, then the
 * participation (`locate` finds it under the room's lock), then those of
 * study-counts. The change, or who to ask about before running again.
 */
async function presenceOnce(
    tx: Tx,
    channelId: string | null,
    locate: Locate,
    zone: string,
    asked: ReadonlyMap<string, boolean>,
    lastRun: boolean,
    step: PresenceStep
): Promise<{ change: PresenceChange | null } | { ask: string[] }> {
    if (channelId) await lockStudyRoom(tx, channelId)
    const participationId = await locate(tx)
    if (!participationId) return { change: null }
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT s."id" FROM "FocusSession" s
        WHERE s."id" = (SELECT p."sessionId" FROM "Participation" p WHERE p."id" = ${participationId})
            AND s."status" <> 'ended'
        FOR UPDATE
    `
    if (!locked) return { change: null }
    const before = toSession(await tx.focusSession.findUniqueOrThrow({ where: { id: locked.id }, select: SESSION }))
    const [place] = await tx.$queryRaw<(Place & { leftAt: Date | null })[]>`
        SELECT "userId", "leftAt", "awaySince", "countedUntil" FROM "Participation" WHERE "id" = ${participationId}
        FOR UPDATE
    `
    if (!place || place.leftAt) return { change: null }
    const what = step(place)
    if (!what) return { change: null }

    const at = latest(wholeSecond(new Date()), before.phaseStartedAt, before.stretchStartedAt)
    const present: Present[] = await tx.participation.findMany({
        where: { sessionId: before.id, leftAt: null, awaySince: null, id: { not: participationId } },
        select: { userId: true, joinedAt: true }
    })
    const answers = lastRun ? new Map(present.map(({ userId }) => [userId, asked.get(userId) ?? false])) : asked
    const move = presenceMove(before, place, what, at, present, answers)
    if (!move) return { ask: present.map(({ userId }) => userId).filter((id) => !asked.has(id)) }

    const counts: StudyCount[] = []
    if ('awaySince' in move.place) {
        await tx.participation.update({ where: { id: participationId }, data: { awaySince: move.place.awaySince } })
    } else {
        // Counted up to `at`, or to when they went away (countLimit), before it closes.
        const count = await countParticipation(tx, participationId, zone, () => at)
        if (count) counts.push(count)
        await tx.participation.update({
            where: { id: participationId },
            data: { leftAt: move.place.leftAt, awaySince: null }
        })
    }
    const hostChanged = move.hostId !== before.hostId
    const data = {
        ...(hostChanged && { hostId: move.hostId, version: before.version + 1 }),
        ...(move.emptySince && { emptySince: move.emptySince })
    }
    const after =
        Object.keys(data).length > 0
            ? toSession(await tx.focusSession.update({ where: { id: before.id }, data, select: SESSION }))
            : before
    return {
        change: {
            before,
            after,
            changed: hostChanged,
            counts,
            summaries: null,
            away: 'awaySince' in move.place ? { participationId, since: move.place.awaySince } : null,
            emptySince: move.emptySince
        }
    }
}

/**
 * The participations a closed stretch or an end counts, in userId order:
 * every open one, and every one closed before all of it was counted. That is
 * one who left while a phase was overdue (its job late): their count stopped
 * at the phase's due end, and the focus stretch the late job opens there,
 * before they left, is counted once it closes.
 */
async function toCount(tx: Tx, sessionId: string): Promise<{ id: string; userId: string }[]> {
    return tx.$queryRaw<{ id: string; userId: string }[]>`
        SELECT "id", "userId" FROM "Participation"
        WHERE "sessionId" = ${sessionId} AND ("leftAt" IS NULL OR "leftAt" > "countedUntil")
        ORDER BY "userId", "joinedAt"
    `
}

/** Who toCount would count now, read before the transaction for their zones. */
async function countedIn(prisma: PrismaService, sessionId: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ userId: string }[]>`
        SELECT DISTINCT "userId" FROM "Participation"
        WHERE "sessionId" = ${sessionId} AND ("leftAt" IS NULL OR "leftAt" > "countedUntil")
    `
    return rows.map(({ userId }) => userId)
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
