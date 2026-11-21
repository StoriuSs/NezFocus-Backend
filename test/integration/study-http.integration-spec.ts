import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import { localDateOf, shownStreak, STUDY_TIME_REPOSITORY, StudyTimeRepositoryPort } from '@/modules/study/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp } from './helpers'

/**
 * Study sessions through the whole app (SRS 4.6, ARCHITECTURE 5, D-215 to
 * D-224). So far the tables of M5 L1 and what the database itself refuses,
 * and the counting of the seconds studied (L2); the sessions come with L3
 * and L4.
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

    describe('counting the seconds studied (ARCHITECTURE 5.2, D-224)', () => {
        const HANOI = 'Asia/Ho_Chi_Minh'
        const server = randomUUID()
        /** A time of Thursday 19/11/2026 in Hà Nội, or of another day. */
        const at = (time: string, date = '2026-11-19') => new Date(`${date}T${time}+07:00`)
        let repository: StudyTimeRepositoryPort

        beforeAll(() => {
            repository = app.get<StudyTimeRepositoryPort>(STUDY_TIME_REPOSITORY)
        })

        afterEach(async () => {
            await prisma.focusSession.deleteMany({
                where: { OR: [{ userId: { in: Object.values(users) } }, { serverId: server }] }
            })
            await prisma.dailyStudy.deleteMany({ where: { userId: { in: Object.values(users) } } })
            await prisma.streak.deleteMany({ where: { userId: { in: Object.values(users) } } })
        })

        /** A session written straight to the table, ended an hour after it began unless told otherwise, with its focus stretches. */
        async function session(
            kind: 'room' | 'solo',
            stretches: [Date, Date | null][],
            shape: Record<string, unknown> = {}
        ) {
            const startedAt = stretches[0][0]
            const { id } = await prisma.focusSession.create({
                data: {
                    kind,
                    ...(kind === 'room'
                        ? { serverId: server, channelId: randomUUID(), hostId: users.an }
                        : { userId: users.an }),
                    focusMinutes: 25,
                    shortBreakMinutes: 5,
                    startedAt,
                    phaseStartedAt: startedAt,
                    status: 'ended',
                    endedAt: new Date(startedAt.getTime() + 3_600_000),
                    endedReason: 'stopped',
                    ...shape
                } as never,
                select: { id: true }
            })
            await prisma.focusStretch.createMany({
                data: stretches.map(([startedAt, endedAt]) => ({ sessionId: id, startedAt, endedAt }))
            })
            return id
        }
        /** A stay not counted yet: countedUntil is where it began. */
        const stay = (who: Who, sessionId: string, joinedAt: Date, shape: { leftAt?: Date; awaySince?: Date } = {}) =>
            prisma.participation
                .create({
                    data: { sessionId, userId: users[who], joinedAt, countedUntil: joinedAt, ...shape },
                    select: { id: true }
                })
                .then((row) => row.id)
        const dayOf = (who: Who, date: string) =>
            prisma.dailyStudy.findUnique({
                where: { userId_localDate: { userId: users[who], localDate: new Date(date) } },
                select: { focusedSeconds: true, roomSeconds: true, soloSeconds: true }
            })
        // Focus 20:00 to 20:25 and 20:30 to 20:55: the Room Session of ROADMAP's "Xong khi".
        const roomEvening = (): [Date, Date][] => [
            [at('20:00:00'), at('20:25:00')],
            [at('20:30:00'), at('20:55:00')]
        ]

        it('counts An in at 19:55 and out at 20:40 as 35 minutes, once, however many times counted', async () => {
            const sessionId = await session('room', roomEvening())
            const an = await stay('an', sessionId, at('19:55:00'), { leftAt: at('20:40:00') })

            const first = await repository.count(an, HANOI)
            expect(first).toMatchObject({ userId: users.an, sessionId, added: 2100, seconds: 2100 })
            expect(first!.countedUntil).toEqual(at('20:40:00'))
            expect(await dayOf('an', '2026-11-19')).toEqual({ focusedSeconds: 2100, roomSeconds: 2100, soloSeconds: 0 })
            expect(first!.streak).toEqual({ current: 1, longest: 1, lastQualifiedDate: '2026-11-19' })
            expect(first!.shownStreak).toBe(shownStreak(first!.streak, localDateOf(new Date(), HANOI)))

            const again = await repository.count(an, HANOI)
            expect(again).toMatchObject({ added: 0, seconds: 2100 })
            expect(await dayOf('an', '2026-11-19')).toEqual({ focusedSeconds: 2100, roomSeconds: 2100, soloSeconds: 0 })
            expect(await prisma.participation.findUnique({ where: { id: an }, select: { seconds: true } })).toEqual({
                seconds: 2100
            })
        })

        it('writes no day for a stay that missed every focus stretch', async () => {
            const sessionId = await session('room', roomEvening())
            const binh = await stay('binh', sessionId, at('20:56:00'), { leftAt: at('20:58:00') })
            expect(await repository.count(binh, HANOI)).toMatchObject({ added: 0, seconds: 0, todaySeconds: 0 })
            expect(await prisma.dailyStudy.count({ where: { userId: users.binh } })).toBe(0)
        })

        it('counts two counts at once of the same stay once (the locks)', async () => {
            const sessionId = await session('room', roomEvening())
            const an = await stay('an', sessionId, at('19:55:00'), { leftAt: at('20:40:00') })
            const both = await Promise.all([repository.count(an, HANOI), repository.count(an, HANOI)])
            expect(both.map((count) => count!.added).sort((a, b) => a - b)).toEqual([0, 2100])
            expect(await dayOf('an', '2026-11-19')).toEqual({ focusedSeconds: 2100, roomSeconds: 2100, soloSeconds: 0 })
        })

        it('sees the 15 minutes reached by two stays of An counted at once, through the lock of the day (D-224)', async () => {
            // The day has a minute already: its row is there, so only FOR UPDATE makes the counts take turns.
            await prisma.dailyStudy.create({
                data: { userId: users.an, localDate: new Date('2026-11-19'), focusedSeconds: 60, roomSeconds: 60 }
            })
            await prisma.streak.create({ data: { userId: users.an } })
            // Two sessions of the same evening, 8 minutes each: with the minute, neither alone reaches 15 minutes.
            const first = await session('room', [[at('20:00:00'), at('20:08:00')]])
            const second = await session('room', [[at('21:00:00'), at('21:08:00')]])
            const stays = [
                await stay('an', first, at('20:00:00'), { leftAt: at('20:08:00') }),
                await stay('an', second, at('21:00:00'), { leftAt: at('21:08:00') })
            ]
            await Promise.all(stays.map((id) => repository.count(id, HANOI)))
            expect(await dayOf('an', '2026-11-19')).toEqual({ focusedSeconds: 1020, roomSeconds: 1020, soloSeconds: 0 })
            expect(
                await prisma.streak.findUnique({
                    where: { userId: users.an },
                    select: { current: true, lastQualifiedDate: true }
                })
            ).toEqual({ current: 1, lastQualifiedDate: new Date('2026-11-19') })
        })
        it('splits a Solo across 00:00 into Solo seconds of both days, each day moving the streak', async () => {
            await prisma.dailyStudy.create({
                data: { userId: users.an, localDate: new Date('2026-11-19'), focusedSeconds: 600, roomSeconds: 600 }
            })
            await prisma.streak.create({
                data: { userId: users.an, current: 1, longest: 1, lastQualifiedDate: new Date('2026-11-18') }
            })
            const sessionId = await session('solo', [[at('23:50:00'), at('00:20:00', '2026-11-20')]])
            const an = await stay('an', sessionId, at('23:50:00'), { leftAt: at('00:20:00', '2026-11-20') })

            expect(await repository.count(an, HANOI)).toMatchObject({
                added: 1800,
                streak: { current: 3, longest: 3, lastQualifiedDate: '2026-11-20' }
            })
            expect(await dayOf('an', '2026-11-19')).toEqual({
                focusedSeconds: 1200,
                roomSeconds: 600,
                soloSeconds: 600
            })
            expect(await dayOf('an', '2026-11-20')).toEqual({ focusedSeconds: 1200, roomSeconds: 0, soloSeconds: 1200 })
            expect(await prisma.streak.findUnique({ where: { userId: users.an }, select: { current: true } })).toEqual({
                current: 3
            })
        })

        it('splits the same stay by the person’s own zone: all on 19/11 in New York', async () => {
            const sessionId = await session('solo', [[at('23:50:00'), at('00:20:00', '2026-11-20')]])
            const an = await stay('an', sessionId, at('23:50:00'), { leftAt: at('00:20:00', '2026-11-20') })
            await repository.count(an, 'America/New_York')
            expect(await dayOf('an', '2026-11-19')).toEqual({ focusedSeconds: 1800, roomSeconds: 0, soloSeconds: 1800 })
            expect(await dayOf('an', '2026-11-20')).toBeNull()
        })

        it('drops what goes past 16 hours a day', async () => {
            await prisma.dailyStudy.create({
                data: {
                    userId: users.an,
                    localDate: new Date('2026-11-19'),
                    focusedSeconds: 57_000,
                    roomSeconds: 57_000
                }
            })
            const sessionId = await session('room', roomEvening())
            const an = await stay('an', sessionId, at('19:55:00'), { leftAt: at('20:40:00') })
            expect(await repository.count(an, HANOI)).toMatchObject({ added: 600, seconds: 600 })
            expect(await dayOf('an', '2026-11-19')).toEqual({
                focusedSeconds: 57_600,
                roomSeconds: 57_600,
                soloSeconds: 0
            })
            // The stay's own seconds are the counted ones, after the cap (D-224).
            expect(await prisma.participation.findUnique({ where: { id: an }, select: { seconds: true } })).toEqual({
                seconds: 600
            })
        })

        it('stops at the time An went away, until An is back (D-215)', async () => {
            const sessionId = await session('room', roomEvening())
            const an = await stay('an', sessionId, at('19:55:00'), { awaySince: at('20:10:00') })
            const count = await repository.count(an, HANOI)
            expect(count).toMatchObject({ added: 600 })
            expect(count!.countedUntil).toEqual(at('20:10:00'))
        })

        it('counts a running focus phase up to where it is due to end, its job late', async () => {
            // Focus began 30 minutes ago and was due to end 5 minutes ago; its job has not run.
            const began = new Date(Math.floor(Date.now() / 1000) * 1000 - 30 * 60_000)
            const due = new Date(began.getTime() + 25 * 60_000)
            const sessionId = await session('room', [[began, null]], {
                status: 'running',
                endedAt: null,
                endedReason: null,
                phaseEndsAt: due
            })
            const an = await stay('an', sessionId, began)
            const count = await repository.count(an, HANOI)
            expect(count).toMatchObject({ added: 1500, seconds: 1500 })
            // Counted up to its due end only: what came after is looked at by the next count.
            expect(count!.countedUntil).toEqual(due)
        })

        it('counts a running focus phase up to now, on a whole second', async () => {
            // Focus began 10 minutes ago, due in 15.
            const began = new Date(Math.floor(Date.now() / 1000) * 1000 - 10 * 60_000)
            const sessionId = await session('room', [[began, null]], {
                status: 'running',
                endedAt: null,
                endedReason: null,
                phaseEndsAt: new Date(began.getTime() + 25 * 60_000)
            })
            const an = await stay('an', sessionId, began)
            const count = await repository.count(an, HANOI)
            expect(count!.added).toBeGreaterThanOrEqual(600)
            expect(count!.added).toBeLessThan(605)
            expect(count!.countedUntil.getMilliseconds()).toBe(0)
            expect(count!.countedUntil.getTime() - began.getTime()).toBe(count!.added * 1000)
        })

        it('finds no participation that is not there', async () => {
            expect(await repository.count(randomUUID(), HANOI)).toBeNull()
        })
    })
})
