import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { getQueueToken } from '@nestjs/bullmq'
import { CommandBus } from '@nestjs/cqrs'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Queue } from 'bullmq'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { Prisma } from '@/generated/prisma/client'
import { Permission } from '@/modules/permissions'
import { EndFocusPhaseCommand, SweepStudyTimersCommand } from '@/modules/study/application'
import { localDateOf, shownStreak, STUDY_TIME_REPOSITORY, StudyTimeRepositoryPort } from '@/modules/study/domain'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, FRONTEND, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Study sessions through the whole app (SRS 4.6, ARCHITECTURE 5, D-215 to
 * D-225). The tables of M5 L1 and what the database itself refuses, the
 * counting of the seconds studied (L2), and Room Sessions started,
 * controlled and moved by their phase jobs (L3a); who joins and leaves
 * comes with L3b, Solo with L4.
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

        it('stops countedUntil at the due end of a running break too, its job late, so the next stretch counts whole', async () => {
            // Focus 35 to 10 minutes ago, then a break due to end 5 minutes ago; its job has not run.
            const began = new Date(Math.floor(Date.now() / 1000) * 1000 - 35 * 60_000)
            const breakAt = new Date(began.getTime() + 25 * 60_000)
            const due = new Date(breakAt.getTime() + 5 * 60_000)
            const sessionId = await session('room', [[began, breakAt]], {
                status: 'running',
                phase: 'short_break',
                phaseIndex: 1,
                phaseStartedAt: breakAt,
                endedAt: null,
                endedReason: null,
                phaseEndsAt: due
            })
            const an = await stay('an', sessionId, began)
            const count = await repository.count(an, HANOI)
            expect(count).toMatchObject({ added: 1500, countedUntil: due })

            // The late job opens the next focus stretch where it was due: counted from there, none lost.
            await prisma.focusStretch.create({
                data: { sessionId, startedAt: due, endedAt: new Date(due.getTime() + 120_000) }
            })
            await prisma.focusSession.update({
                where: { id: sessionId },
                data: {
                    status: 'ended',
                    phase: 'focus',
                    phaseIndex: 2,
                    phaseEndsAt: null,
                    endedAt: new Date(),
                    endedReason: 'stopped'
                }
            })
            expect(await repository.count(an, HANOI)).toMatchObject({ added: 120, seconds: 1620 })
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

    describe('Room Sessions: start, control, phase ends (REQ-STUDY-02, STUDY-03, D-222, D-225)', () => {
        const CLIENT_IP = testClientIp()
        const PASSWORD = 'Harbour-Lantern-42'
        type Person = 'an' | 'binh' | 'chi' | 'dung' | 'phong'
        const people = {} as Record<Person, { token: string; id: string }>
        const opened: Socket[] = []
        let socketUrl: string
        let serverId: string
        let room: string
        let managersRoom: string
        let plainRoom: string
        let textChannel: string

        const api = () => request(app.getHttpServer())
        const anyone = (req: request.Test) => req.set('X-Forwarded-For', CLIENT_IP).set('Origin', FRONTEND)
        const as = (who: Person, req: request.Test) => anyone(req).set('Authorization', `Bearer ${people[who].token}`)
        const post = (path: string, body: object = {}, token?: string) => {
            const req = anyone(api().post(`/api/v1/${path}`))
            return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body)
        }
        const outcome = (res: request.Response) => [res.status, res.body.meta?.type, res.body.data?.reason]
        const start = (who: Person, channelId: string, body: object = {}) =>
            as(who, api().post(`/api/v1/channels/${channelId}/focus-session`))
                .set('Idempotency-Key', randomUUID())
                .send(body)
        const command = (who: Person, sessionId: string, action: string, body: object) =>
            as(who, api().post(`/api/v1/focus-sessions/${sessionId}/${action}`)).send(body)
        const bus = () => app.get(CommandBus)
        const studyQueue = () => app.get<Queue>(getQueueToken(QUEUES.STUDY))

        /** Puts people in a voice room, as LiveKit's webhook would (VoiceState is voice's; only the rows matter here). */
        const enter = (channelId: string, ...who: Person[]) =>
            prisma.voiceState.createMany({
                data: who.map((person, i) => ({
                    userId: people[person].id,
                    channelId,
                    participantSid: `PA_${person}`,
                    joinedAt: new Date(Date.now() - (who.length - i) * 1000)
                }))
            })

        /** Moves a session's whole story `seconds` back, as if that much time had passed since. */
        async function rewind(sessionId: string, seconds: number) {
            const back = Prisma.sql`(${seconds} * interval '1 second')`
            await prisma.$executeRaw`
                UPDATE "FocusSession" SET "phaseStartedAt" = "phaseStartedAt" - ${back},
                    "phaseEndsAt" = "phaseEndsAt" - ${back}, "startedAt" = "startedAt" - ${back}
                WHERE "id" = ${sessionId}`
            await prisma.$executeRaw`
                UPDATE "FocusStretch" SET "startedAt" = "startedAt" - ${back}, "endedAt" = "endedAt" - ${back}
                WHERE "sessionId" = ${sessionId}`
            await prisma.$executeRaw`
                UPDATE "Participation" SET "joinedAt" = "joinedAt" - ${back}, "countedUntil" = "countedUntil" - ${back},
                    "leftAt" = "leftAt" - ${back}
                WHERE "sessionId" = ${sessionId}`
        }

        const participations = (sessionId: string) =>
            prisma.participation.findMany({
                where: { sessionId },
                select: { userId: true, seconds: true, leftAt: true },
                orderBy: { userId: 'asc' }
            })

        async function signUp(who: Person) {
            const email = `${PREFIX}-l3-${who}@example.test`
            const { accessToken } = await signInWithCode(post, email)
            await completeAccount(post, accessToken, PASSWORD)
            const me = await anyone(api().get('/api/v1/users/me')).set('Authorization', `Bearer ${accessToken}`)
            people[who] = { token: accessToken, id: me.body.data.id }
        }

        async function connectAs(who: Person): Promise<Socket> {
            const res = await as(who, api().post('/api/v1/realtime/ticket'))
            const socket = io(socketUrl, {
                auth: { ticket: res.body.data.ticket },
                transports: ['websocket'],
                reconnection: false,
                forceNew: true,
                extraHeaders: { Origin: FRONTEND }
            })
            opened.push(socket)
            await new Promise((resolve) => socket.once('ready', resolve))
            return socket
        }

        function collect(socket: Socket, event: string): () => Promise<Record<string, unknown>[]> {
            const heard: Record<string, unknown>[] = []
            socket.on(event, (data: Record<string, unknown>) => heard.push(data))
            return () => new Promise((resolve) => setTimeout(() => resolve(heard), 400))
        }

        beforeAll(async () => {
            await app.listen(0)
            socketUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
            for (const who of ['an', 'binh', 'chi', 'dung', 'phong'] as Person[]) await signUp(who)

            const created = await as('an', api().post('/api/v1/servers'))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Nhóm ôn thi', template: 'standard' })
            serverId = created.body.data.id
            const invite = await as('an', api().post(`/api/v1/servers/${serverId}/invites`))
                .set('Idempotency-Key', randomUUID())
                .send({ max_age_seconds: null, max_uses: null })
            for (const who of ['binh', 'chi', 'dung', 'phong'] as Person[]) {
                await as(who, api().post(`/api/v1/invites/${invite.body.data.code}/accept`))
            }
            const channel = async (type: 'text' | 'voice', name: string, isStudyRoom = false) => {
                const res = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                    .set('Idempotency-Key', randomUUID())
                    .send({ type, name, is_study_room: isStudyRoom, is_private: false, view_role_ids: [] })
                return res.body.data.id as string
            }
            room = await channel('voice', 'Phòng học im lặng', true)
            managersRoom = await channel('voice', 'Phòng thi thử', true)
            plainRoom = await channel('voice', 'Phòng tán gẫu')
            textChannel = await channel('text', 'hoi-dap')
            await as('an', api().patch(`/api/v1/servers/${serverId}/channels/${managersRoom}`)).send({
                study_starter: 'managers'
            })

            // Chi coordinates the study rooms (MANAGE_STUDY_ROOMS); Dũng is timed out.
            const role = await as('an', api().post(`/api/v1/servers/${serverId}/roles`))
                .set('Idempotency-Key', randomUUID())
                .send({ name: 'Điều phối phòng học' })
            const roleId: string = role.body.data.role_id
            await as('an', api().patch(`/api/v1/servers/${serverId}/roles/${roleId}`)).send({
                permissions: Permission.MANAGE_STUDY_ROOMS.toString()
            })
            await as('an', api().put(`/api/v1/servers/${serverId}/roles/${roleId}/members`)).send({
                user_ids: [people.chi.id]
            })
            await as('an', api().patch(`/api/v1/servers/${serverId}/members/${people.dung.id}`)).send({
                timeout_seconds: 86_400,
                reason: 'Thử'
            })
        })

        afterEach(async () => {
            for (const socket of opened.splice(0)) socket.disconnect()
            await prisma.voiceState.deleteMany({ where: { userId: { in: Object.values(people).map((p) => p.id) } } })
            await prisma.focusSession.deleteMany({ where: { serverId } })
        })

        afterAll(async () => {
            const all = Object.values(people).map((person) => person.id)
            await prisma.focusSession.deleteMany({ where: { serverId } }).catch(() => undefined)
            await prisma.server.deleteMany({ where: { ownerId: { in: all } } }).catch(() => undefined)
            await prisma.user.deleteMany({ where: { id: { in: all } } }).catch(() => undefined)
        })

        describe('starting one (POST /channels/{id}/focus-session)', () => {
            it('makes the one who pressed Host and everyone in the room a participant, from now', async () => {
                await enter(room, 'an', 'binh')
                const res = await start('an', room)
                expect(res.status).toBe(201)
                const session = res.body.data
                expect(session).toMatchObject({
                    kind: 'room',
                    channel_id: room,
                    host_id: people.an.id,
                    focus_minutes: 25,
                    short_break_minutes: 5,
                    long_break_minutes: null,
                    status: 'running',
                    phase: 'focus',
                    phase_index: 0,
                    paused_remaining_ms: null,
                    version: 0
                })
                const startedAt = Date.parse(session.started_at)
                expect(startedAt % 1000).toBe(0)
                expect(Date.parse(session.phase_ends_at) - startedAt).toBe(25 * 60_000)
                expect(session.stretch_started_at).toBe(session.started_at)
                expect(Math.abs(Date.parse(session.server_time) - Date.now())).toBeLessThan(5000)
                expect((await participations(session.id)).map((p) => p.userId)).toEqual(
                    [people.an.id, people.binh.id].sort()
                )

                // The room lists it, the chat says it, and its phase end waits in the queue.
                const listed = await as('binh', api().get(`/api/v1/servers/${serverId}`))
                const channels = listed.body.data.channels as { id: string; focus_session: unknown }[]
                expect(channels.find((c) => c.id === room)?.focus_session).toMatchObject({ id: session.id, version: 0 })
                expect(channels.find((c) => c.id === plainRoom)?.focus_session).toBeNull()
                expect(channels.find((c) => c.id === textChannel)?.focus_session).toBeNull()
                const said = await prisma.message.findFirst({
                    where: { channelId: room, systemEvent: 'study_session_started' }
                })
                expect(said?.systemData).toMatchObject({
                    userId: people.an.id,
                    sessionId: session.id,
                    focusMinutes: 25
                })
                const job = await studyQueue().getJob(`focus-${session.id}-0`)
                expect(job?.data).toEqual({ sessionId: session.id, version: 0 })
                expect(job!.opts.delay).toBeGreaterThan(24 * 60_000)
            })

            it('takes the cycle sent, and refuses one a study room could not have', async () => {
                await enter(room, 'an')
                const half = await start('an', room, {
                    focus_minutes: 50,
                    short_break_minutes: 10,
                    long_break_minutes: 20
                })
                expect(outcome(half)).toEqual([422, 'VALIDATION_ERROR', undefined])
                expect(half.body.data).toMatchObject({ rule: 'study_cycle', problem: 'long_break_pair' })
                expect(outcome(await start('an', room, { focus_minutes: 50 }))).toEqual([
                    422,
                    'VALIDATION_ERROR',
                    undefined
                ])
                expect(outcome(await start('an', room, { focus_minutes: 3, short_break_minutes: 5 }))[0]).toBe(422)

                const res = await start('an', room, { focus_minutes: 50, short_break_minutes: 10 })
                expect(res.status).toBe(201)
                expect(Date.parse(res.body.data.phase_ends_at) - Date.parse(res.body.data.started_at)).toBe(50 * 60_000)
            })

            it('is FOCUS_SESSION_ACTIVE in a room that has one, also for two starts at once', async () => {
                await enter(room, 'an', 'binh')
                const both = await Promise.all([start('an', room), start('binh', room)])
                expect(both.map((res) => res.status).sort()).toEqual([201, 409])
                expect(both.find((res) => res.status === 409)?.body.meta.type).toBe('FOCUS_SESSION_ACTIVE')
                expect(await prisma.focusSession.count({ where: { channelId: room, status: { not: 'ended' } } })).toBe(
                    1
                )
            })

            it('says why not: no study room, not in it, only managers start here, timed out, not seen', async () => {
                await enter(plainRoom, 'an')
                expect(outcome(await start('an', plainRoom))).toEqual([403, 'FORBIDDEN_ERROR', 'not_study_room'])
                expect(outcome(await start('binh', room))).toEqual([403, 'FORBIDDEN_ERROR', 'not_in_room'])
                await prisma.voiceState.deleteMany({ where: { userId: people.an.id } })
                await enter(managersRoom, 'binh', 'chi')
                expect(outcome(await start('binh', managersRoom))).toEqual([403, 'FORBIDDEN_ERROR', 'cannot_start'])
                expect((await start('chi', managersRoom)).status).toBe(201)
                expect(outcome(await start('dung', room))).toEqual([403, 'MEMBER_TIMED_OUT', undefined])
                expect(outcome(await start('an', textChannel))[0]).toBe(404)
                expect(outcome(await start('an', randomUUID()))[0]).toBe(404)
            })

            it('starts nothing for one still taking part in another session (D-222): no Host without their seconds', async () => {
                await enter(managersRoom, 'chi')
                expect((await start('chi', managersRoom)).status).toBe(201)
                // Chi moves to the other room; leaving is M5 L3b, so her time in the first is still open.
                await prisma.voiceState.update({ where: { userId: people.chi.id }, data: { channelId: room } })
                await enter(room, 'an')
                const res = await start('chi', room)
                expect(outcome(res)).toEqual([409, 'FOCUS_SESSION_ACTIVE', undefined])
                expect(await prisma.focusSession.count({ where: { channelId: room } })).toBe(0)
            })
        })

        describe('controlling one (POST /focus-sessions/{id}/…)', () => {
            async function running(...who: Person[]) {
                await enter(room, ...(who.length ? who : (['an', 'binh'] as Person[])))
                const res = await start(who[0] ?? 'an', room)
                expect(res.status).toBe(201)
                return res.body.data.id as string
            }

            it('pauses the phase the room is really in when the phase end before it was lost, losing no second (D-225)', async () => {
                const id = await running()
                await studyQueue().remove(`focus-${id}-0`)
                // Focus, then its break, due 30 seconds ago; neither phase end has run.
                await rewind(id, 30 * 60 + 30)
                const paused = await command('an', id, 'pause', { version: 0 })
                expect(paused.body.data).toMatchObject({ status: 'paused', phase: 'focus', phase_index: 2, version: 1 })
                // 25 minutes of the first focus phase, and the 30 seconds of the second.
                for (const { seconds } of await participations(id)) {
                    expect(seconds).toBeGreaterThanOrEqual(1530)
                    expect(seconds).toBeLessThanOrEqual(1535)
                }
                expect(await prisma.focusStretch.count({ where: { sessionId: id } })).toBe(2)
            })

            it('shows 10:00 again on resume after a pause at 10:00, and counts the 15 minutes before', async () => {
                const id = await running()
                await rewind(id, 15 * 60)
                const paused = await command('an', id, 'pause', { version: 0 })
                expect(paused.status).toBe(200)
                expect(paused.body.data).toMatchObject({
                    status: 'paused',
                    phase_ends_at: null,
                    version: 1,
                    stretch_started_at: null
                })
                const left = paused.body.data.paused_remaining_ms
                expect(left).toBeGreaterThanOrEqual(595_000)
                expect(left).toBeLessThanOrEqual(600_000)
                for (const { seconds } of await participations(id)) {
                    expect(seconds).toBeGreaterThanOrEqual(900)
                    expect(seconds).toBeLessThanOrEqual(905)
                }
                expect(await studyQueue().getJob(`focus-${id}-0`)).toBeUndefined()

                const resumed = await command('an', id, 'resume', { version: 1 })
                expect(resumed.body.data).toMatchObject({ status: 'running', version: 2 })
                const { phase_ends_at, server_time, stretch_started_at } = resumed.body.data
                expect(Math.abs(Date.parse(phase_ends_at) - Date.parse(server_time) - left)).toBeLessThan(1500)
                expect(stretch_started_at).not.toBeNull()
                expect(await studyQueue().getJob(`focus-${id}-2`)).toBeDefined()
            })

            it('changes nothing for a command sent with an old version, or one already done (D-225)', async () => {
                const id = await running()
                expect((await command('an', id, 'pause', { version: 0 })).body.data.version).toBe(1)
                const again = await command('an', id, 'pause', { version: 1 })
                expect(again.status).toBe(200)
                expect(again.body.data).toMatchObject({ status: 'paused', version: 1 })
                const stale = await command('an', id, 'resume', { version: 0 })
                expect(stale.body.data).toMatchObject({ status: 'paused', version: 1 })
                expect(outcome(await command('an', id, 'pause', {}))[0]).toBe(422)
            })

            it('skips one phase only when the Host and a manager press Skip at once', async () => {
                const id = await running()
                const both = await Promise.all([
                    command('an', id, 'skip', { version: 0 }),
                    command('chi', id, 'skip', { version: 0 })
                ])
                expect(both.map((res) => res.status)).toEqual([200, 200])
                const now = await prisma.focusSession.findUniqueOrThrow({ where: { id } })
                expect(now).toMatchObject({ phase: 'short_break', phaseIndex: 1, version: 1 })
                expect(await prisma.focusStretch.count({ where: { sessionId: id, endedAt: null } })).toBe(0)
            })

            it('decides on the session once it holds its row: a change committed meanwhile is seen (the row lock)', async () => {
                const id = await running()
                let release!: () => void
                const released = new Promise<void>((resolve) => (release = resolve))
                // Another change holds the row and moves its version; the pause sent for version 0 waits.
                const holder = prisma.$transaction(
                    async (tx) => {
                        await tx.$queryRaw`SELECT "id" FROM "FocusSession" WHERE "id" = ${id} FOR UPDATE`
                        await tx.focusSession.update({ where: { id }, data: { version: 5 } })
                        await released
                    },
                    { timeout: 20_000 }
                )
                await new Promise((resolve) => setTimeout(resolve, 200))
                const pausing = command('an', id, 'pause', { version: 0 }).then((res) => res)
                await new Promise((resolve) => setTimeout(resolve, 500))
                release()
                await holder
                // Read before the lock, it would have paused version 0 and written version 1.
                expect((await pausing).body.data).toMatchObject({ status: 'running', version: 5 })
            })

            it('keeps the next phase paused when skipped while paused; a new cycle only while paused (D-50)', async () => {
                const id = await running()
                const tooSoon = await command('an', id, 'config', {
                    version: 0,
                    focus_minutes: 50,
                    short_break_minutes: 10
                })
                expect(outcome(tooSoon)).toEqual([422, 'VALIDATION_ERROR', undefined])
                expect(tooSoon.body.data).toMatchObject({ rule: 'not_paused' })

                await command('an', id, 'pause', { version: 0 })
                const skipped = await command('an', id, 'skip', { version: 1 })
                expect(skipped.body.data).toMatchObject({
                    status: 'paused',
                    phase: 'short_break',
                    paused_remaining_ms: 5 * 60_000,
                    version: 2
                })
                const changed = await command('an', id, 'config', {
                    version: 2,
                    focus_minutes: 50,
                    short_break_minutes: 10
                })
                expect(changed.body.data).toMatchObject({
                    status: 'paused',
                    phase: 'short_break',
                    focus_minutes: 50,
                    short_break_minutes: 10,
                    paused_remaining_ms: 10 * 60_000,
                    version: 3
                })
            })

            it('lets only the Host and those with MANAGE_STUDY_ROOMS control, in the room or not', async () => {
                const id = await running('an', 'binh')
                expect(outcome(await command('binh', id, 'pause', { version: 0 }))).toEqual([
                    403,
                    'FORBIDDEN_ERROR',
                    'not_host'
                ])
                expect(outcome(await command('dung', id, 'pause', { version: 0 }))).toEqual([
                    403,
                    'MEMBER_TIMED_OUT',
                    undefined
                ])
                expect(outcome(await command('an', randomUUID(), 'pause', { version: 0 }))[0]).toBe(404)
                expect((await command('chi', id, 'pause', { version: 0 })).body.data.status).toBe('paused')
            })

            it('lets anyone in the room resume a paused session with no Host, and nothing else (D-119)', async () => {
                const id = await running('an', 'phong')
                await command('an', id, 'pause', { version: 0 })
                await prisma.focusSession.update({ where: { id }, data: { hostId: null } })
                expect(outcome(await command('phong', id, 'skip', { version: 1 }))).toEqual([
                    403,
                    'FORBIDDEN_ERROR',
                    'not_host'
                ])
                expect(outcome(await command('binh', id, 'resume', { version: 1 }))).toEqual([
                    403,
                    'FORBIDDEN_ERROR',
                    'not_host'
                ])
                expect((await command('phong', id, 'resume', { version: 1 })).body.data.status).toBe('running')
            })

            it('stops for the whole room: everyone counted and out, the room told each one their own seconds (D-49)', async () => {
                const id = await running('an', 'binh')
                const an = await connectAs('an')
                const ended = collect(an, 'focus_session.ended')
                const streak = collect(an, 'streak.updated')
                await rewind(id, 31 * 60)

                const stopped = await command('chi', id, 'stop', { version: 0 })
                expect(stopped.body.data).toMatchObject({ status: 'ended', ended_reason: 'stopped', version: 1 })
                const rows = await participations(id)
                expect(rows.every((row) => row.leftAt !== null)).toBe(true)
                // 25 minutes of focus, the break, then the first minute of the next focus phase, which its jobs (late
                // here) never began: the stop makes those phase ends first (D-225), 1560 seconds each.
                expect(rows.map((row) => row.seconds)).toEqual([1560, 1560])

                const [event] = await ended()
                expect(event).toMatchObject({ id, action: 'stop', actor_id: people.chi.id, ended_reason: 'stopped' })
                expect(event.summaries).toEqual(
                    [people.an.id, people.binh.id].sort().map((userId) => ({ user_id: userId, seconds: 1560 }))
                )
                expect((await streak())[0]).toMatchObject({ current: 1, today_seconds: expect.any(Number) })
                const said = await prisma.message.findFirst({
                    where: { channelId: room, systemEvent: 'study_session_ended' }
                })
                expect(said?.systemData).toEqual({ sessionId: id, reason: 'stopped' })
                const listed = await as('an', api().get(`/api/v1/servers/${serverId}`))
                expect(listed.body.data.channels.find((c: { id: string }) => c.id === room).focus_session).toBeNull()
            })

            it('closes a stay counted a little ahead of this clock (another instance) where it was counted, not before', async () => {
                const id = await running('an')
                await command('an', id, 'pause', { version: 0 })
                // Another instance, its clock 5 seconds ahead, counted this stay up to its own now.
                const ahead = new Date(Math.floor(Date.now() / 1000) * 1000 + 5000)
                await prisma.participation.updateMany({ where: { sessionId: id }, data: { countedUntil: ahead } })
                const stopped = await command('an', id, 'stop', { version: 1 })
                expect(stopped.status).toBe(200)
                const [row] = await participations(id)
                expect(row.leftAt).toEqual(ahead)
            })

            it('tells the room each change with the server clock, what was done and by whom', async () => {
                const binh = await connectAs('binh')
                const started = collect(binh, 'focus_session.started')
                const updated = collect(binh, 'focus_session.updated')
                const id = await running('an', 'binh')
                await command('an', id, 'pause', { version: 0 })
                const [first] = await started()
                expect(first).toMatchObject({ id, action: 'start', actor_id: people.an.id, version: 0 })
                expect(first.server_time).toEqual(expect.any(String))
                expect((await updated()).map((e) => [e.action, e.version, e.status])).toEqual([['pause', 1, 'paused']])
            })
        })

        describe('the end of a phase, by its job or the sweep (ARCHITECTURE 5.1, D-225)', () => {
            it('begins the next phase when the last was due, counting the focus phase, and sets the next job', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                await rewind(id, 25 * 60 + 4)
                const due = (await prisma.focusSession.findUniqueOrThrow({ where: { id } })).phaseEndsAt!

                await bus().execute(new EndFocusPhaseCommand(id, 0))
                const now = await prisma.focusSession.findUniqueOrThrow({ where: { id } })
                expect(now).toMatchObject({ phase: 'short_break', phaseIndex: 1, version: 1, phaseStartedAt: due })
                expect(now.phaseEndsAt!.getTime() - due.getTime()).toBe(5 * 60_000)
                expect((await prisma.focusStretch.findFirstOrThrow({ where: { sessionId: id } })).endedAt).toEqual(due)
                expect((await participations(id)).map((p) => p.seconds)).toEqual([1500, 1500])
                expect(await studyQueue().getJob(`focus-${id}-1`)).toBeDefined()

                // The same job again, or a late one of an older version, changes nothing.
                await bus().execute(new EndFocusPhaseCommand(id, 0))
                expect((await prisma.focusSession.findUniqueOrThrow({ where: { id } })).version).toBe(1)
            })

            it('runs the phase ends whose job was lost, each opening the focus stretch at its planned start', async () => {
                await enter(room, 'an')
                const id = (await start('an', room)).body.data.id as string
                await studyQueue().remove(`focus-${id}-0`)
                await rewind(id, 25 * 60)
                expect(await bus().execute(new SweepStudyTimersCommand(new Date()))).toBeGreaterThanOrEqual(1)
                expect(await prisma.focusSession.findUniqueOrThrow({ where: { id } })).toMatchObject({
                    phase: 'short_break'
                })

                await rewind(id, 5 * 60)
                const breakEnd = (await prisma.focusSession.findUniqueOrThrow({ where: { id } })).phaseEndsAt!
                expect(await bus().execute(new SweepStudyTimersCommand(new Date()))).toBeGreaterThanOrEqual(1)
                const focus = await prisma.focusSession.findUniqueOrThrow({ where: { id } })
                expect(focus).toMatchObject({ phase: 'focus', phaseIndex: 2, version: 2, phaseStartedAt: breakEnd })
                expect(await prisma.focusStretch.findFirst({ where: { sessionId: id, endedAt: null } })).toMatchObject({
                    startedAt: breakEnd
                })
            })

            it('leaves a session paused meanwhile alone', async () => {
                await enter(room, 'an')
                const id = (await start('an', room)).body.data.id as string
                await command('an', id, 'pause', { version: 0 })
                await bus().execute(new EndFocusPhaseCommand(id, 0))
                expect(await prisma.focusSession.findUniqueOrThrow({ where: { id } })).toMatchObject({
                    status: 'paused',
                    version: 1
                })
            })
        })
    })
})
