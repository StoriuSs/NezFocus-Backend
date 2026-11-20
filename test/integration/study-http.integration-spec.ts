import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp } from './helpers'

/**
 * Study sessions through the whole app (SRS 4.6, ARCHITECTURE 5, D-215 to
 * D-223). So far the tables of M5 L1 and what the database itself refuses;
 * the sessions come with L3 and L4.
 *
 * Requires Postgres, Redis, Mailpit and LiveKit: `pnpm test:services:up`,
 * then `pnpm test:integration`.
 */
describe('Study sessions (integration)', () => {
    const PREFIX = `itest-study-${randomUUID().slice(0, 8)}`
    type Who = 'an' | 'binh'

    let app: NestExpressApplication
    let prisma: PrismaService
    const users = {} as Record<Who, string>

    beforeAll(async () => {
        app = await bootApp()
        prisma = app.get(PrismaService)
        for (const who of ['an', 'binh'] as Who[]) {
            const user = await prisma.user.create({ data: { email: `${PREFIX}-${who}@example.test` } })
            users[who] = user.id
        }
    })

    afterAll(async () => {
        await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined)
        await closeApp(app)
    })

    describe('constraints of the database (20261120200000_study)', () => {
        type DatabaseError = { meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } }
        /** The constraint that refused a write, as Postgres names it; "written" when none did. */
        const refusedBy = (write: Promise<unknown>): Promise<string> =>
            write.then(
                () => 'written',
                (error: DatabaseError) => {
                    const said = error.meta?.driverAdapterError?.cause?.originalMessage ?? String(error)
                    return /constraint "([^"]+)"/.exec(said)?.[1] ?? said
                }
            )
        // Rooms and servers are plain ids (D-223): any will do.
        const room = randomUUID()
        const otherRoom = randomUUID()
        const server = randomUUID()
        const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000)

        /** A Room Session written straight to the table: running 25/5 in `room` unless told otherwise. */
        const roomSession = (shape: Record<string, unknown> = {}) =>
            prisma.focusSession
                .create({
                    data: {
                        kind: 'room',
                        serverId: server,
                        channelId: room,
                        hostId: users.an,
                        focusMinutes: 25,
                        shortBreakMinutes: 5,
                        phaseStartedAt: new Date(),
                        phaseEndsAt: minutesFromNow(25),
                        ...shape
                    } as never,
                    select: { id: true }
                })
                .then((row) => row.id)
        /** An's Solo written straight to the table, running 25/5 unless told otherwise. */
        const solo = (shape: Record<string, unknown> = {}) =>
            prisma.focusSession
                .create({
                    data: {
                        kind: 'solo',
                        userId: users.an,
                        focusMinutes: 25,
                        shortBreakMinutes: 5,
                        phaseStartedAt: new Date(),
                        phaseEndsAt: minutesFromNow(25),
                        ...shape
                    } as never,
                    select: { id: true }
                })
                .then((row) => row.id)
        // Begun an hour ago: an end must not come before the start.
        const ended = {
            status: 'ended',
            phaseEndsAt: null,
            startedAt: minutesFromNow(-60),
            endedAt: new Date(),
            endedReason: 'stopped'
        }
        const join = (who: Who, sessionId: string, shape: Record<string, unknown> = {}) => {
            const joinedAt = new Date()
            return prisma.participation.create({
                data: { sessionId, userId: users[who], joinedAt, countedUntil: joinedAt, ...shape } as never,
                select: { id: true }
            })
        }
        const day = (shape: { focusedSeconds: number; roomSeconds?: number; soloSeconds?: number }) =>
            prisma.dailyStudy.create({
                data: { userId: users.an, localDate: new Date('2026-11-20'), ...shape },
                select: { userId: true }
            })

        afterEach(async () => {
            await prisma.focusSession.deleteMany({
                where: { OR: [{ userId: { in: Object.values(users) } }, { serverId: server }] }
            })
            await prisma.dailyStudy.deleteMany({ where: { userId: { in: Object.values(users) } } })
            await prisma.streak.deleteMany({ where: { userId: { in: Object.values(users) } } })
        })

        it('keeps one session not yet ended per room, and one Solo per person (FOCUS_SESSION_ACTIVE)', async () => {
            expect(await refusedBy(roomSession())).toBe('written')
            expect(await refusedBy(roomSession({ status: 'paused', phaseEndsAt: null, pausedRemainingMs: 1 }))).toBe(
                'FocusSession_one_open_per_room'
            )
            expect(await refusedBy(roomSession({ channelId: otherRoom }))).toBe('written')
            // Ended sessions are history, as many as there were.
            expect(await refusedBy(roomSession(ended))).toBe('written')

            expect(await refusedBy(solo())).toBe('written')
            expect(await refusedBy(solo())).toBe('FocusSession_one_open_solo_per_person')
            expect(await refusedBy(solo(ended))).toBe('written')
            expect(await refusedBy(solo({ userId: users.binh }))).toBe('written')
        })

        it('keeps a Room Session to its room and a Solo to its person, and each end reason to its kind', async () => {
            for (const wrong of [
                { channelId: null },
                { serverId: null },
                { userId: users.an },
                { status: 'waiting', phaseEndsAt: null, waitingUntil: minutesFromNow(10) },
                { ...ended, endedReason: 'expired' },
                { ...ended, endedReason: 'joined_room' },
                { ...ended, endedReason: 'signed_out' }
            ]) {
                expect([wrong, await refusedBy(roomSession(wrong))]).toEqual([wrong, 'FocusSession_kind_check'])
            }
            for (const wrong of [
                { channelId: room },
                { serverId: server },
                { hostId: users.an },
                { userId: null },
                { ...ended, endedReason: 'empty' },
                { ...ended, endedReason: 'channel_deleted' }
            ]) {
                expect([wrong, await refusedBy(solo(wrong))]).toEqual([wrong, 'FocusSession_kind_check'])
            }
            expect(await refusedBy(solo({ ...ended, endedReason: 'signed_out' }))).toBe('written')
            expect(await refusedBy(roomSession({ ...ended, endedReason: 'study_disabled' }))).toBe('written')
        })

        it('keeps the cycle in the ranges of a study room', async () => {
            for (const wrong of [
                { focusMinutes: 4 },
                { focusMinutes: 121 },
                { shortBreakMinutes: 0 },
                { shortBreakMinutes: 31 },
                { longBreakMinutes: 15 },
                { longBreakEvery: 4 },
                { longBreakMinutes: 61, longBreakEvery: 4 },
                { longBreakMinutes: 15, longBreakEvery: 9 },
                { longBreakMinutes: 4, longBreakEvery: 4 },
                { longBreakMinutes: 15, longBreakEvery: 1 }
            ]) {
                expect([wrong, await refusedBy(solo(wrong))]).toEqual([wrong, 'FocusSession_cycle_check'])
            }
            // The ends of each range are in it.
            for (const right of [
                { focusMinutes: 5, shortBreakMinutes: 1, longBreakMinutes: 5, longBreakEvery: 2 },
                { focusMinutes: 120, shortBreakMinutes: 30, longBreakMinutes: 60, longBreakEvery: 8 }
            ]) {
                expect([right, await refusedBy(solo(right))]).toEqual([right, 'written'])
                await prisma.focusSession.deleteMany({ where: { userId: users.an } })
            }
        })

        it('gives each state its own time and only it', async () => {
            for (const wrong of [
                { phaseEndsAt: null },
                { pausedRemainingMs: 1000 },
                { waitingUntil: minutesFromNow(10) },
                { status: 'paused', phaseEndsAt: null },
                { status: 'paused', phaseEndsAt: null, pausedRemainingMs: -1 },
                { status: 'paused', pausedRemainingMs: 1000 },
                { status: 'paused', phaseEndsAt: null, pausedRemainingMs: 1000, waitingUntil: minutesFromNow(10) },
                { status: 'waiting', phaseEndsAt: null },
                { status: 'waiting', waitingUntil: minutesFromNow(10) },
                { status: 'waiting', phaseEndsAt: null, waitingUntil: minutesFromNow(10), pausedRemainingMs: 1000 },
                { ...ended, endedAt: null },
                { ...ended, endedReason: null },
                { ...ended, phaseEndsAt: minutesFromNow(1) },
                { ...ended, pausedRemainingMs: 1000 },
                { ...ended, waitingUntil: minutesFromNow(10) },
                // Running, yet with an end (after its start: only the state is wrong).
                { startedAt: minutesFromNow(-60), endedAt: new Date() },
                { ...ended, startedAt: new Date(), endedAt: new Date(Date.now() - 1000) },
                { version: -1 }
            ]) {
                expect([wrong, await refusedBy(solo(wrong))]).toEqual([wrong, 'FocusSession_status_check'])
            }
            expect(
                await refusedBy(solo({ status: 'waiting', phaseEndsAt: null, waitingUntil: minutesFromNow(10) }))
            ).toBe('written')
        })

        it('takes focus and breaks in turn, focus phases the even ones, and a long break only in a cycle with one', async () => {
            for (const wrong of [
                { phaseIndex: 1 },
                { phase: 'short_break', phaseIndex: 0 },
                { phase: 'long_break', phaseIndex: 4 },
                { phaseIndex: -2 },
                { phase: 'long_break', phaseIndex: 7 }
            ]) {
                expect([wrong, await refusedBy(solo(wrong))]).toEqual([wrong, 'FocusSession_phase_check'])
            }
            expect(
                await refusedBy(solo({ phase: 'long_break', phaseIndex: 7, longBreakMinutes: 15, longBreakEvery: 4 }))
            ).toBe('written')
        })

        it('keeps one focus stretch open per session, none ending before it starts (D-216)', async () => {
            const sessionId = await solo()
            const stretch = (shape: { startedAt?: Date; endedAt?: Date | null } = {}) =>
                prisma.focusStretch.create({
                    data: { sessionId, startedAt: new Date(), ...shape },
                    select: { id: true }
                })
            expect(await refusedBy(stretch({ endedAt: new Date(Date.now() + 1000) }))).toBe('written')
            expect(await refusedBy(stretch())).toBe('written')
            expect(await refusedBy(stretch())).toBe('FocusStretch_one_open_per_session')
            expect(await refusedBy(stretch({ endedAt: new Date(Date.now() - 1000) }))).toBe('FocusStretch_time_check')
        })

        it('keeps one open participation per person, whatever the session (D-103, D-223)', async () => {
            const own = await solo()
            const shared = await roomSession()
            expect(await refusedBy(join('an', own))).toBe('written')
            // In a Solo, An cannot be counted in the room too.
            expect(await refusedBy(join('an', shared))).toBe('Participation_one_open_per_person')
            expect(await refusedBy(join('binh', shared))).toBe('written')
            // Closed rows are history: Bình left and came back.
            await prisma.participation.updateMany({ where: { userId: users.binh }, data: { leftAt: new Date() } })
            expect(await refusedBy(join('binh', shared))).toBe('written')
        })

        it('keeps a participation in time: away only while open, nothing counted before joining or past leaving or going away (D-215)', async () => {
            const sessionId = await roomSession()
            const before = new Date(Date.now() - 60_000)
            const later = (seconds: number) => new Date(Date.now() + seconds * 1000)
            for (const wrong of [
                // Counted up to 2 seconds from now, yet gone or away a second before.
                { countedUntil: later(2), leftAt: later(1) },
                { countedUntil: later(2), awaySince: later(1) },
                { leftAt: before },
                { leftAt: new Date(Date.now() + 1000), awaySince: new Date(Date.now() + 1000) },
                { awaySince: before },
                { countedUntil: before },
                { seconds: -1 }
            ]) {
                expect([wrong, await refusedBy(join('an', sessionId, wrong))]).toEqual([
                    wrong,
                    'Participation_time_check'
                ])
            }
            expect(await refusedBy(join('an', sessionId, { awaySince: new Date(Date.now() + 1000) }))).toBe('written')
        })

        it('keeps a day at focused = room + solo, 16 hours at most (D-104, REQ-STUDY-04)', async () => {
            for (const wrong of [
                { focusedSeconds: 60, roomSeconds: 30, soloSeconds: 20 },
                { focusedSeconds: 57_601, roomSeconds: 57_601 },
                { focusedSeconds: 0, roomSeconds: 10, soloSeconds: -10 },
                { focusedSeconds: 0, roomSeconds: -10, soloSeconds: 10 }
            ]) {
                expect([wrong, await refusedBy(day(wrong))]).toEqual([wrong, 'DailyStudy_seconds_check'])
            }
            expect(await refusedBy(day({ focusedSeconds: 57_600, roomSeconds: 50_000, soloSeconds: 7600 }))).toBe(
                'written'
            )
        })

        it('keeps a streak whole: the longest run at least the current, 0 only before the first good day', async () => {
            const streak = (shape: { current: number; longest: number; lastQualifiedDate?: Date }) =>
                prisma.streak.create({ data: { userId: users.an, ...shape }, select: { userId: true } })
            const today = new Date('2026-11-20')
            for (const wrong of [
                { current: 3, longest: 2, lastQualifiedDate: today },
                { current: 0, longest: 2, lastQualifiedDate: today },
                { current: 1, longest: 1 },
                { current: -1, longest: 0, lastQualifiedDate: today }
            ]) {
                expect([wrong, await refusedBy(streak(wrong))]).toEqual([wrong, 'Streak_runs_check'])
            }
            expect(await refusedBy(streak({ current: 2, longest: 5, lastQualifiedDate: today }))).toBe('written')
        })
    })
})
