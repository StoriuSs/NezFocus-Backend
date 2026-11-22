import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { getQueueToken } from '@nestjs/bullmq'
import { CommandBus, EventBus } from '@nestjs/cqrs'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Queue } from 'bullmq'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { Prisma } from '@/generated/prisma/client'
import { Permission } from '@/modules/permissions'
import {
    CloseAwayCommand,
    EndFocusPhaseCommand,
    JoinStudyRoomCommand,
    LeaveStudyRoomCommand,
    SESSION_JOBS,
    SessionJobsPort,
    SweepStudyTimersCommand
} from '@/modules/study/application'
import { localDateOf, shownStreak, STUDY_TIME_REPOSITORY, StudyTimeRepositoryPort } from '@/modules/study/domain'
import { VoiceStateChangedEvent } from '@/modules/voice'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { bootApp, closeApp, completeAccount, cookieOf, FRONTEND, pair, signInWithCode } from './helpers'
import { testClientIp } from './targets'

/**
 * Study sessions through the whole app (SRS 4.6, ARCHITECTURE 5, D-215 to
 * D-225). The tables of M5 L1 and what the database itself refuses, the
 * counting of the seconds studied (L2), Room Sessions started, controlled
 * and moved by their phase jobs (L3a), who joins and leaves them, their
 * Host, an empty room and a room gone (L3b), the Solo, which yields to a
 * Room Session (L4a), and the Stats page's reads (L4b).
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

    describe('Room Sessions: start, control, phase ends, who is in them (REQ-STUDY-02, STUDY-03, D-222, D-225, D-227)', () => {
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
                    "phaseEndsAt" = "phaseEndsAt" - ${back}, "startedAt" = "startedAt" - ${back},
                    "emptySince" = "emptySince" - ${back}, "waitingUntil" = "waitingUntil" - ${back}
                WHERE "id" = ${sessionId}`
            await prisma.$executeRaw`
                UPDATE "FocusStretch" SET "startedAt" = "startedAt" - ${back}, "endedAt" = "endedAt" - ${back}
                WHERE "sessionId" = ${sessionId}`
            await prisma.$executeRaw`
                UPDATE "Participation" SET "joinedAt" = "joinedAt" - ${back}, "countedUntil" = "countedUntil" - ${back},
                    "leftAt" = "leftAt" - ${back}, "awaySince" = "awaySince" - ${back}
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
            await prisma.focusSession.deleteMany({ where: { userId: { in: Object.values(people).map((p) => p.id) } } })
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
                // Connected first: the seconds counted are the time since the start, which a slow connect would add to.
                const an = await connectAs('an')
                const ended = collect(an, 'focus_session.ended')
                const streak = collect(an, 'streak.updated')
                // Seconds are counted by whole-second marks: start and stop within one second, from its start.
                await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 20))
                const id = await running('an', 'binh')
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
                // The streak as stored once counted: 1, or 2 when an earlier rewind of this run reached yesterday
                // (a run just after midnight in the person's zone).
                const stored = await prisma.streak.findUniqueOrThrow({ where: { userId: people.an.id } })
                expect(stored.current).toBeGreaterThanOrEqual(1)
                // As the session started, where An's participation counts from; once stopped, in no session (D-232).
                const told = await streak()
                expect(told[0]).toMatchObject({ counted_until: expect.any(String) })
                expect(told.at(-1)).toMatchObject({
                    current: stored.current,
                    today_seconds: expect.any(Number),
                    counted_until: null
                })
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

        describe('who joins and leaves, the Host, an empty room, a room gone (ARCHITECTURE 5.2, 5.3, D-215, D-227)', () => {
            const placeOf = (sessionId: string, who: Person) =>
                prisma.participation.findFirstOrThrow({
                    where: { sessionId, userId: people[who].id },
                    orderBy: { joinedAt: 'desc' }
                })
            const sessionRow = (id: string) => prisma.focusSession.findUniqueOrThrow({ where: { id } })
            const join = (who: Person, channelId = room) =>
                bus().execute(new JoinStudyRoomCommand(channelId, people[who].id))
            const leave = (who: Person, lost = false, channelId = room) =>
                bus().execute(new LeaveStudyRoomCommand(channelId, people[who].id, lost))

            /** Waits until `check` gives something truthy, or fails after 5 s. */
            async function until<T>(check: () => Promise<T | null | undefined | false>): Promise<T> {
                for (let i = 0; i < 50; i++) {
                    const found = await check()
                    if (found) return found
                    await new Promise((resolve) => setTimeout(resolve, 100))
                }
                throw new Error('waited 5 s for nothing')
            }

            it('tells one who joins mid-session where they count from, and once they leave that they are in none (D-232)', async () => {
                await enter(room, 'an')
                const id = (await start('an', room)).body.data.id as string
                const binh = await connectAs('binh')
                const heard: Record<string, unknown>[] = []
                binh.on('streak.updated', (data: Record<string, unknown>) => heard.push(data))

                await enter(room, 'binh')
                await join('binh')
                const place = await placeOf(id, 'binh')
                // Told of the join before leaving: the two reads after their commits stay in that order.
                await until(async () => heard.length >= 1)
                await prisma.voiceState.deleteMany({ where: { userId: people.binh.id } })
                await leave('binh')
                await until(async () => heard.length >= 2)

                expect(heard[0]).toMatchObject({
                    counted_until: place.countedUntil.toISOString(),
                    today_seconds: expect.any(Number)
                })
                expect(heard.at(-1)).toMatchObject({ counted_until: null })
                // Each says when it was read, the later read later (D-232).
                const [first, last] = [heard[0], heard.at(-1)].map((one) => Date.parse(String(one?.read_at)))
                expect(first).toBeLessThan(last)
            })

            it('tells one who leaves, and no one else, their seconds in the session, every stay added (D-233)', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                const binh = collect(await connectAs('binh'), 'focus_session.left')
                const an = collect(await connectAs('an'), 'focus_session.left')

                await rewind(id, 60)
                await leave('binh')
                await join('binh')
                await rewind(id, 60)
                await leave('binh')

                const heard = await binh()
                expect(heard).toHaveLength(2)
                const stays = await prisma.participation.findMany({
                    where: { sessionId: id, userId: people.binh.id },
                    orderBy: { joinedAt: 'asc' }
                })
                expect(stays).toHaveLength(2)
                expect(heard[0]).toEqual({ session_id: id, channel_id: room, seconds: stays[0].seconds })
                expect(heard[1]).toEqual({
                    session_id: id,
                    channel_id: room,
                    seconds: stays[0].seconds + stays[1].seconds
                })
                expect(heard[1].seconds).toBeGreaterThanOrEqual(120)
                expect(await an()).toEqual([])
            })

            it('tells each one still there their seconds as the session ends with them (D-233)', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                const binh = collect(await connectAs('binh'), 'focus_session.left')
                await rewind(id, 60)
                await command('an', id, 'stop', { version: 0 })
                expect(await binh()).toEqual([
                    { session_id: id, channel_id: room, seconds: (await placeOf(id, 'binh')).seconds }
                ])
            })

            it('names the next Host for the Host only, as a leaving would choose, the Host left out (D-233)', async () => {
                await enter(room, 'an', 'binh', 'phong')
                const id = (await start('an', room)).body.data.id as string
                // Bình's connection lost: away, so not the next Host; Phong is.
                await leave('binh', true)

                const next = await as('an', api().get(`/api/v1/focus-sessions/${id}/next-host`)).expect(200)
                expect(next.body.data).toEqual({ next_host: { id: people.phong.id, display_name: expect.any(String) } })
                const refused = await as('phong', api().get(`/api/v1/focus-sessions/${id}/next-host`))
                expect(outcome(refused)).toEqual([403, 'FORBIDDEN_ERROR', 'not_host'])

                await leave('phong')
                const none = await as('an', api().get(`/api/v1/focus-sessions/${id}/next-host`)).expect(200)
                expect(none.body.data).toEqual({ next_host: null })
            })

            it('the flow of "Xong khi": Bình comes 12 minutes in, An leaves and Bình is Host, the room empty 5 minutes ends it', async () => {
                await enter(room, 'an')
                const id = (await start('an', room)).body.data.id as string
                await rewind(id, 12 * 60)

                // Bình joins, as voice tells it after LiveKit's webhook.
                await enter(room, 'binh')
                app.get(EventBus).publish(new VoiceStateChangedEvent(room, people.binh.id, 'joined', new Date()))
                await until(() => prisma.participation.findFirst({ where: { sessionId: id, userId: people.binh.id } }))
                const listed = await as('binh', api().get(`/api/v1/servers/${serverId}`))
                const shown = (
                    listed.body.data.channels as { id: string; focus_session: Record<string, string> }[]
                ).find((channel) => channel.id === room)!.focus_session
                const left = Date.parse(shown.phase_ends_at) - Date.parse(shown.server_time)
                expect(left).toBeGreaterThan(13 * 60_000 - 5000)
                expect(left).toBeLessThanOrEqual(13 * 60_000)

                // An leaves: counted now, and Bình, first of those present who may start, is Host.
                const socket = await connectAs('binh')
                const updates = collect(socket, 'focus_session.updated')
                await leave('an')
                const an = await placeOf(id, 'an')
                expect(an.leftAt).not.toBeNull()
                expect(an.seconds).toBeGreaterThanOrEqual(12 * 60)
                expect(an.seconds).toBeLessThan(12 * 60 + 10)
                expect(await sessionRow(id)).toMatchObject({ hostId: people.binh.id, version: 1, emptySince: null })
                expect(await updates()).toEqual([
                    expect.objectContaining({ action: 'host', actor_id: null, host_id: people.binh.id, version: 1 })
                ])

                // Bình's connection lost: away, the room empty from then, both timers waiting in the queue.
                app.get(EventBus).publish(new VoiceStateChangedEvent(room, people.binh.id, 'left', new Date(), true))
                const empty = await until(async () => (await sessionRow(id)).emptySince)
                const binh = await placeOf(id, 'binh')
                expect(binh).toMatchObject({ awaySince: empty, leftAt: null })
                expect(await sessionRow(id)).toMatchObject({ hostId: people.binh.id, version: 1 })
                expect(await studyQueue().getJob(`empty-${id}-${empty.getTime()}`)).toBeDefined()
                expect(await studyQueue().getJob(`away-${binh.id}-${empty.getTime()}`)).toBeDefined()

                // 5 minutes on, their jobs lost: the sweep ends it (empty), Bình closed at the time they went away.
                await rewind(id, 5 * 60)
                const awaySince = (await placeOf(id, 'binh')).awaySince!
                await bus().execute(new SweepStudyTimersCommand(new Date()))
                expect(await sessionRow(id)).toMatchObject({ status: 'ended', endedReason: 'empty', emptySince: null })
                expect(await placeOf(id, 'binh')).toMatchObject({ leftAt: awaySince, awaySince: null })
            })

            it('takes one back within 3 minutes as never gone: one place, the time away counted (D-215)', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                await rewind(id, 60)
                await leave('binh', true)
                await rewind(id, 2 * 60)
                await join('binh')
                await command('an', id, 'pause', { version: 0 })

                const places = await prisma.participation.findMany({ where: { sessionId: id, userId: people.binh.id } })
                expect(places).toHaveLength(1)
                expect(places[0]).toMatchObject({ awaySince: null, leftAt: null })
                expect(places[0].seconds).toBeGreaterThanOrEqual(3 * 60)
                expect(places[0].seconds).toBe((await placeOf(id, 'an')).seconds)
            })

            it('closes the place of one away past 3 minutes at the time they went away, and the Host hands over', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                await rewind(id, 60)
                await leave('an', true)
                // Still Host while away.
                expect(await sessionRow(id)).toMatchObject({ hostId: people.an.id, version: 0 })
                await rewind(id, 4 * 60)
                const away = await placeOf(id, 'an')

                await bus().execute(new CloseAwayCommand(away.id, away.awaySince!))
                const an = await placeOf(id, 'an')
                expect(an).toMatchObject({ leftAt: away.awaySince, awaySince: null })
                expect(an.seconds).toBeGreaterThanOrEqual(60)
                expect(an.seconds).toBeLessThan(65)
                expect(await sessionRow(id)).toMatchObject({ hostId: people.binh.id, version: 1 })
            })

            it('takes Rời as meant when LiveKit’s leave came first: closed at once, the Host handed over (D-228)', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                // The page left LiveKit first: its webhook took An's row as a lost connection.
                await prisma.voiceState.delete({ where: { userId: people.an.id } })
                await leave('an', true)
                const away = await placeOf(id, 'an')
                expect(away.awaySince).not.toBeNull()

                await as('an', api().post('/api/v1/voice/leave')).send({}).expect(200)
                await until(async () => (await placeOf(id, 'an')).leftAt)
                expect(await placeOf(id, 'an')).toMatchObject({ leftAt: away.awaySince, awaySince: null })
                expect(await sessionRow(id)).toMatchObject({ hostId: people.binh.id, version: 1 })
            })

            it('counts one away as not present: never the next Host, and the room empty once the rest are away too', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                await rewind(id, 60)
                await enter(room, 'phong')
                await join('phong')
                // Bình came before Phong, but is away.
                await leave('binh', true)
                await leave('an')
                expect(await sessionRow(id)).toMatchObject({ hostId: people.phong.id, version: 1, emptySince: null })

                await leave('phong', true)
                expect((await sessionRow(id)).emptySince).toEqual((await placeOf(id, 'phong')).awaySince)
            })

            it('runs on with no Host when nobody present may start, until one who may comes in (REQ-STUDY-03)', async () => {
                await enter(managersRoom, 'chi', 'binh')
                const id = (await start('chi', managersRoom)).body.data.id as string
                await leave('chi', false, managersRoom)
                expect(await sessionRow(id)).toMatchObject({ hostId: null, version: 1 })
                // Bình, not Host and not able to start here, controls nothing.
                await command('binh', id, 'pause', { version: 1 }).expect(403)

                await join('chi', managersRoom)
                expect(await sessionRow(id)).toMatchObject({ hostId: people.chi.id, version: 2 })
                expect(await prisma.participation.count({ where: { sessionId: id, userId: people.chi.id } })).toBe(2)
            })

            it('closes a place away when its person comes into a room with no session too, and hands the Host over (D-215)', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                await leave('an', true)
                const away = await placeOf(id, 'an')

                await prisma.voiceState.update({ where: { userId: people.an.id }, data: { channelId: plainRoom } })
                await join('an', plainRoom)
                expect(await placeOf(id, 'an')).toMatchObject({ leftAt: away.awaySince, awaySince: null })
                expect(await sessionRow(id)).toMatchObject({ hostId: people.binh.id, version: 1 })
            })

            it('closes a place away in one room when its person comes into another, at the time they went away', async () => {
                await enter(room, 'an', 'binh')
                const first = (await start('an', room)).body.data.id as string
                await leave('binh', true)
                const away = await placeOf(first, 'binh')
                await enter(managersRoom, 'chi')
                const second = (await start('chi', managersRoom)).body.data.id as string

                await prisma.voiceState.update({ where: { userId: people.binh.id }, data: { channelId: managersRoom } })
                await join('binh', managersRoom)
                expect(await placeOf(first, 'binh')).toMatchObject({ leftAt: away.awaySince, awaySince: null })
                expect(await placeOf(second, 'binh')).toMatchObject({ leftAt: null, awaySince: null })
            })

            it('makes one who joins as a session starts take part: the join waits for the start (the room lock)', async () => {
                await enter(room, 'an', 'binh')
                let release!: () => void
                const held = new Promise<void>((resolve) => (release = resolve))
                let sessionId: string | null = null
                const now = new Date(Math.floor(Date.now() / 1000) * 1000)
                // A start in progress: it holds the room's lock and wrote its session, not yet committed.
                const starting = prisma.$transaction(
                    async (tx) => {
                        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`study-room:${room}`}, 0))`
                        const session = await tx.focusSession.create({
                            data: {
                                kind: 'room',
                                serverId,
                                channelId: room,
                                hostId: people.an.id,
                                focusMinutes: 25,
                                shortBreakMinutes: 5,
                                phaseStartedAt: now,
                                phaseEndsAt: new Date(now.getTime() + 25 * 60_000),
                                startedAt: now
                            }
                        })
                        await tx.participation.create({
                            data: { sessionId: session.id, userId: people.an.id, joinedAt: now, countedUntil: now }
                        })
                        sessionId = session.id
                        await held
                    },
                    { timeout: 20_000 }
                )
                await until(async () => sessionId)
                const joining = join('binh')
                await new Promise((resolve) => setTimeout(resolve, 300))
                release()
                await starting
                await joining
                expect((await participations(sessionId!)).map((p) => p.userId)).toEqual(
                    [people.an.id, people.binh.id].sort()
                )
            })

            it('closes the place of one who leaves as a session starts: the leaving waits for the start (the room lock)', async () => {
                await enter(room, 'an', 'binh')
                let release!: () => void
                const held = new Promise<void>((resolve) => (release = resolve))
                let sessionId: string | null = null
                const now = new Date(Math.floor(Date.now() / 1000) * 1000)
                // A start in progress read Bình in the room, and wrote their place, not yet committed.
                const starting = prisma.$transaction(
                    async (tx) => {
                        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`study-room:${room}`}, 0))`
                        const session = await tx.focusSession.create({
                            data: {
                                kind: 'room',
                                serverId,
                                channelId: room,
                                hostId: people.an.id,
                                focusMinutes: 25,
                                shortBreakMinutes: 5,
                                phaseStartedAt: now,
                                phaseEndsAt: new Date(now.getTime() + 25 * 60_000),
                                startedAt: now
                            }
                        })
                        await tx.participation.createMany({
                            data: [people.an.id, people.binh.id].map((userId) => ({
                                sessionId: session.id,
                                userId,
                                joinedAt: now,
                                countedUntil: now
                            }))
                        })
                        sessionId = session.id
                        await held
                    },
                    { timeout: 20_000 }
                )
                await until(async () => sessionId)
                const leaving = leave('binh')
                await new Promise((resolve) => setTimeout(resolve, 300))
                release()
                await starting
                await leaving
                expect((await placeOf(sessionId!, 'binh')).leftAt).not.toBeNull()
            })

            it('counts the focus a late phase job began before one left: no second lost (D-225)', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                // The break ended 10 seconds ago and its job is late: Bình leaves meanwhile.
                await studyQueue().remove(`focus-${id}-0`)
                await rewind(id, 25 * 60)
                await bus().execute(new EndFocusPhaseCommand(id, 0))
                await studyQueue().remove(`focus-${id}-1`)
                await rewind(id, 5 * 60 + 10)
                await leave('binh')
                expect((await placeOf(id, 'binh')).seconds).toBe(1500)

                // The late job opens the focus phase when it was due; the pause closes it and counts Bình's 10 seconds.
                await bus().execute(new EndFocusPhaseCommand(id, 1))
                await command('an', id, 'pause', { version: 2 })
                const binh = await placeOf(id, 'binh')
                expect(binh.seconds).toBeGreaterThanOrEqual(1510)
                expect(binh.seconds).toBeLessThan(1515)
                expect(binh.countedUntil).toEqual(binh.leftAt)
            })

            it('sets who is present against who is in the room when their events were lost (D-225)', async () => {
                await enter(room, 'an', 'binh')
                const id = (await start('an', room)).body.data.id as string
                await prisma.voiceState.delete({ where: { userId: people.binh.id } })
                await enter(room, 'phong')
                await bus().execute(new SweepStudyTimersCommand(new Date()))
                expect((await placeOf(id, 'binh')).awaySince).not.toBeNull()
                expect(await placeOf(id, 'phong')).toMatchObject({ leftAt: null, awaySince: null })
                expect((await placeOf(id, 'an')).awaySince).toBeNull()
            })

            it('ends the session of a room turned off (study_disabled), saying so in its chat (REQ-STUDY-02, D-227)', async () => {
                await enter(room, 'an')
                const id = (await start('an', room)).body.data.id as string
                try {
                    await as('an', api().patch(`/api/v1/servers/${serverId}/channels/${room}`))
                        .send({ is_study_room: false })
                        .expect(200)
                    await until(async () => (await sessionRow(id)).status === 'ended')
                    expect(await sessionRow(id)).toMatchObject({ endedReason: 'study_disabled' })
                    expect((await placeOf(id, 'an')).leftAt).not.toBeNull()
                    await until(() =>
                        prisma.message.findFirst({
                            where: {
                                channelId: room,
                                systemEvent: 'study_session_ended',
                                systemData: { path: ['sessionId'], equals: id }
                            }
                        })
                    )
                } finally {
                    await as('an', api().patch(`/api/v1/servers/${serverId}/channels/${room}`)).send({
                        is_study_room: true
                    })
                }
            })

            it('ends the session of a room deleted (channel_deleted)', async () => {
                const created = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                    .set('Idempotency-Key', randomUUID())
                    .send({
                        type: 'voice',
                        name: 'Phòng tạm',
                        is_study_room: true,
                        is_private: false,
                        view_role_ids: []
                    })
                const gone = created.body.data.id as string
                await enter(gone, 'an')
                const id = (await start('an', gone)).body.data.id as string
                await as('an', api().delete(`/api/v1/servers/${serverId}/channels/${gone}`)).expect(200)
                await until(async () => (await sessionRow(id)).status === 'ended')
                expect(await sessionRow(id)).toMatchObject({ endedReason: 'channel_deleted' })
            })
        })

        describe('Solo (REQ-STUDY-05, D-103, D-229)', () => {
            const startSolo = (who: Person, body: object = {}) =>
                as(who, api().post('/api/v1/me/solo-session')).set('Idempotency-Key', randomUUID()).send(body)
            const soloOf = (who: Person) => as(who, api().get('/api/v1/me/solo-session'))
            const row = (id: string) => prisma.focusSession.findUniqueOrThrow({ where: { id } })
            const placeIn = (sessionId: string, who: Person = 'an') =>
                prisma.participation.findFirstOrThrow({ where: { sessionId, userId: people[who].id } })
            const FIRST = {
                focus_minutes: 25,
                short_break_minutes: 5,
                long_break_minutes: null,
                long_break_every: null
            }

            /** Waits until `check` gives something truthy, or fails after 5 s. */
            async function until<T>(check: () => Promise<T | null | undefined | false>): Promise<T> {
                for (let i = 0; i < 50; i++) {
                    const found = await check()
                    if (found) return found
                    await new Promise((resolve) => setTimeout(resolve, 100))
                }
                throw new Error('waited 5 s for nothing')
            }

            /** A Solo of An's, 5/1, brought to waiting: its focus phase counted (300 s), its break over by its job. */
            async function waitingSolo(): Promise<{ id: string; breakEnd: Date }> {
                const id = (await startSolo('an', { focus_minutes: 5, short_break_minutes: 1 })).body.data.id as string
                await rewind(id, 5 * 60 + 1)
                await bus().execute(new EndFocusPhaseCommand(id, 0))
                await rewind(id, 60 + 1)
                await bus().execute(new EndFocusPhaseCommand(id, 1))
                const waiting = await row(id)
                return { id, breakEnd: new Date(waiting.phaseStartedAt.getTime() + 60_000) }
            }

            it('starts with the cycle sent; its person alone hears it; a reload reads it back with the next start’s cycle', async () => {
                const socket = await connectAs('an')
                const heard = collect(socket, 'solo_session.updated')
                const res = await startSolo('an', { focus_minutes: 50, short_break_minutes: 10 })
                expect(res.status).toBe(201)
                const id = res.body.data.id as string
                expect(res.body.data).toMatchObject({
                    kind: 'solo',
                    channel_id: null,
                    host_id: null,
                    focus_minutes: 50,
                    status: 'running',
                    phase: 'focus',
                    version: 0,
                    counted_seconds: 0
                })
                expect((await soloOf('an')).body.data).toMatchObject({
                    session: {
                        id,
                        status: 'running',
                        stretch_started_at: res.body.data.started_at,
                        counted_seconds: 0
                    },
                    start_cycle: {
                        focus_minutes: 50,
                        short_break_minutes: 10,
                        long_break_minutes: null,
                        long_break_every: null
                    }
                })
                expect(await heard()).toEqual([
                    expect.objectContaining({ id, action: 'start', actor_id: people.an.id })
                ])
                expect((await soloOf('binh')).body.data).toEqual({ session: null, start_cycle: FIRST })
            })

            it('starts the next with the last one’s cycle when sent none; FOCUS_SESSION_ACTIVE while one runs, or in a Room Session', async () => {
                const first = (await startSolo('an', { focus_minutes: 50, short_break_minutes: 10 })).body.data
                expect(outcome(await startSolo('an'))).toEqual([409, 'FOCUS_SESSION_ACTIVE', undefined])
                await command('an', first.id, 'stop', { version: 0 })
                expect((await soloOf('an')).body.data.session).toBeNull()
                const second = (await startSolo('an', { focus_minutes: 40, short_break_minutes: 8 })).body.data
                await command('an', second.id, 'stop', { version: 0 })
                expect((await startSolo('an')).body.data).toMatchObject({ focus_minutes: 40, short_break_minutes: 8 })

                await enter(room, 'binh')
                await start('binh', room)
                expect(outcome(await startSolo('binh'))).toEqual([409, 'FOCUS_SESSION_ACTIVE', undefined])
            })

            it('starts one Solo only for two starts at once (Participation_one_open_per_person)', async () => {
                const both = await Promise.all([startSolo('phong'), startSolo('phong')])
                expect(both.map((res) => res.status).sort()).toEqual([201, 409])
                expect(
                    await prisma.focusSession.count({ where: { userId: people.phong.id, status: { not: 'ended' } } })
                ).toBe(1)
            })

            it('lets only its person control it: anyone else, a manager too, is NOT_FOUND', async () => {
                const id = (await startSolo('an')).body.data.id as string
                expect(outcome(await command('chi', id, 'pause', { version: 0 }))[0]).toBe(404)
                expect((await command('an', id, 'pause', { version: 0 })).body.data).toMatchObject({
                    status: 'paused',
                    version: 1
                })
            })

            it('waits 10 minutes once its break ends; Học tiếp begins focus at the press, the seconds before kept', async () => {
                const { id, breakEnd } = await waitingSolo()
                const waiting = await row(id)
                expect(waiting).toMatchObject({ status: 'waiting', version: 2, phaseEndsAt: null })
                expect(waiting.waitingUntil!.getTime() - breakEnd.getTime()).toBe(10 * 60_000)
                expect(await studyQueue().getJob(`focus-${id}-2`)).toBeDefined()
                // Its focus phase counted: what "18 phút bạn đã học" reads (D-234).
                expect((await soloOf('an')).body.data.session).toMatchObject({
                    status: 'waiting',
                    counted_seconds: 300
                })

                await rewind(id, 4 * 60)
                const pressed = Date.now()
                const res = await command('an', id, 'continue', { version: 2 })
                expect(res.body.data).toMatchObject({
                    status: 'running',
                    phase: 'focus',
                    phase_index: 2,
                    version: 3,
                    counted_seconds: 300
                })
                expect(Date.parse(res.body.data.phase_started_at)).toBeGreaterThan(pressed - 2000)
                expect(res.body.data.stretch_started_at).toBe(res.body.data.phase_started_at)
                expect((await placeIn(id)).seconds).toBe(300)
            })

            it('ends a wait not taken up as expired, at the end of its break, its job lost: the sweep (D-225)', async () => {
                const { id, breakEnd } = await waitingSolo()
                await rewind(id, 10 * 60 + 1)
                await bus().execute(new SweepStudyTimersCommand(new Date()))
                const ended = await row(id)
                expect(ended).toMatchObject({ status: 'ended', endedReason: 'expired', waitingUntil: null })
                expect(ended.endedAt!.getTime()).toBe(breakEnd.getTime() - (10 * 60 + 1) * 1000)
                expect(await placeIn(id)).toMatchObject({ seconds: 300, leftAt: ended.endedAt })
            })

            it('ends An’s Solo when another starts a session in An’s room: +18 minutes kept, An in from that second (D-103)', async () => {
                await enter(room, 'an', 'binh')
                const soloId = (await startSolo('an')).body.data.id as string
                await rewind(soloId, 18 * 60)
                const socket = await connectAs('an')
                const heard = collect(socket, 'solo_session.updated')
                const started = (await start('binh', room)).body.data
                const id = started.id as string
                // A Room Session's people are many: no seconds of one of them (D-234).
                expect(started.counted_seconds).toBeNull()

                const solo = await row(soloId)
                expect(solo).toMatchObject({ status: 'ended', endedReason: 'joined_room' })
                const soloPlace = await placeIn(soloId)
                expect(soloPlace.seconds).toBeGreaterThanOrEqual(18 * 60)
                expect(soloPlace.seconds).toBeLessThan(18 * 60 + 5)
                expect(soloPlace.leftAt).toEqual(solo.endedAt)
                // No second lost or counted twice: the room counts An from the second the Solo ended.
                expect((await placeIn(id)).joinedAt).toEqual(solo.endedAt)
                expect(await heard()).toEqual([
                    expect.objectContaining({
                        id: soloId,
                        status: 'ended',
                        ended_reason: 'joined_room',
                        action: 'end',
                        actor_id: null,
                        counted_seconds: soloPlace.seconds,
                        summaries: [{ user_id: people.an.id, seconds: soloPlace.seconds }]
                    })
                ])
            })

            it('ends the Solo of one who comes into a room with a session, in from when it ended; none in a room with no session', async () => {
                const soloId = (await startSolo('an')).body.data.id as string
                await enter(plainRoom, 'an')
                await bus().execute(new JoinStudyRoomCommand(plainRoom, people.an.id))
                expect((await row(soloId)).status).toBe('running')
                await prisma.voiceState.deleteMany({ where: { userId: people.an.id } })

                await enter(room, 'binh')
                const id = (await start('binh', room)).body.data.id as string
                await enter(room, 'an')
                await bus().execute(new JoinStudyRoomCommand(room, people.an.id))
                const solo = await row(soloId)
                expect(solo).toMatchObject({ status: 'ended', endedReason: 'joined_room' })
                expect((await placeIn(id)).joinedAt).toEqual(solo.endedAt)
            })

            it('keeps a Solo going when its person leaves a voice room with no session, however they leave (D-228)', async () => {
                const soloId = (await startSolo('an')).body.data.id as string
                await enter(plainRoom, 'an')
                await bus().execute(new JoinStudyRoomCommand(plainRoom, people.an.id))
                await bus().execute(new LeaveStudyRoomCommand(plainRoom, people.an.id, true))
                await bus().execute(new LeaveStudyRoomCommand(plainRoom, people.an.id, false))
                await bus().execute(new LeaveStudyRoomCommand(null, people.an.id, false))
                expect((await row(soloId)).status).toBe('running')
                expect((await placeIn(soloId)).leftAt).toBeNull()
            })

            it('takes part from when the Solo ended when its times run ahead of this clock (another instance): no second twice', async () => {
                /** An's Solo as another instance a few seconds ahead wrote it: its phase and stretch begin then. */
                const soloAhead = async () => {
                    const id = (await startSolo('an')).body.data.id as string
                    const ahead = new Date(Math.ceil(Date.now() / 1000) * 1000 + 3000)
                    await prisma.focusSession.update({
                        where: { id },
                        data: { phaseStartedAt: ahead, phaseEndsAt: new Date(ahead.getTime() + 25 * 60_000) }
                    })
                    await prisma.focusStretch.updateMany({ where: { sessionId: id }, data: { startedAt: ahead } })
                    return { id, ahead }
                }
                // A session started in An's room.
                await enter(room, 'an', 'binh')
                const first = await soloAhead()
                const started = (await start('binh', room)).body.data.id as string
                expect((await row(first.id)).endedAt).toEqual(first.ahead)
                expect((await placeIn(started)).joinedAt).toEqual(first.ahead)
                await command('binh', started, 'stop', { version: 0 })

                // An coming into a room with a session.
                await prisma.voiceState.deleteMany({ where: { userId: people.an.id } })
                const second = await soloAhead()
                const id = (await start('binh', room)).body.data.id as string
                await enter(room, 'an')
                await bus().execute(new JoinStudyRoomCommand(room, people.an.id))
                expect((await row(second.id)).endedAt).toEqual(second.ahead)
                expect((await placeIn(id)).joinedAt).toEqual(second.ahead)
            })

            it('ends the Solo of one who presses Đăng xuất, on another device than the one that started it (D-229)', async () => {
                const login = await post('auth/login', { email: `${PREFIX}-l3-binh@example.test`, password: PASSWORD })
                expect(login.status).toBe(200)
                const soloId = (await startSolo('binh')).body.data.id as string
                expect((await post('auth/logout').set('Cookie', pair(cookieOf(login, 'refresh_token')))).status).toBe(
                    200
                )
                await until(async () => (await row(soloId)).status === 'ended')
                expect(await row(soloId)).toMatchObject({ endedReason: 'signed_out' })
                expect((await placeIn(soloId, 'binh')).leftAt).not.toBeNull()
            })

            it('ends the Solo of an account that starts to wait for deletion, signed out everywhere (D-229)', async () => {
                const { accessToken } = await signInWithCode(post, `${PREFIX}-l4-xoa@example.test`)
                await completeAccount(post, accessToken, PASSWORD)
                const started = await anyone(api().post('/api/v1/me/solo-session'))
                    .set('Authorization', `Bearer ${accessToken}`)
                    .set('Idempotency-Key', randomUUID())
                    .send({})
                expect(started.status).toBe(201)
                const soloId = started.body.data.id as string
                expect((await post('auth/account/delete', { password: PASSWORD }, accessToken)).status).toBe(200)
                await until(async () => (await row(soloId)).status === 'ended')
                expect(await row(soloId)).toMatchObject({ endedReason: 'signed_out' })
            })
        })

        describe('the Stats page (GET /me/study-stats, GET /me/study-sessions, D-105, D-229, D-230)', () => {
            // Phong, in Asia/Ho_Chi_Minh (completeAccount). Days and sessions of October 2026, all gone by.
            const me = () => people.phong.id
            const read = (path: string) => as('phong', api().get(`/api/v1/me/${path}`))
            const seeded: string[] = []

            const days = (rows: [date: string, roomMinutes: number, soloMinutes: number][]) =>
                prisma.dailyStudy.createMany({
                    data: rows.map(([date, room, solo]) => ({
                        userId: me(),
                        localDate: new Date(`${date}T00:00:00.000Z`),
                        roomSeconds: room * 60,
                        soloSeconds: solo * 60,
                        focusedSeconds: (room + solo) * 60
                    }))
                })

            /** A session gone by with Phong's joins in it: [joined, left, seconds counted]. */
            async function pastSession(
                place: { serverId: string; channelId: string } | 'solo',
                joins: [joinedAt: string, leftAt: string | null, seconds: number][]
            ): Promise<string> {
                const first = new Date(joins[0][0])
                const session = await prisma.focusSession.create({
                    data: {
                        kind: place === 'solo' ? 'solo' : 'room',
                        serverId: place === 'solo' ? null : place.serverId,
                        channelId: place === 'solo' ? null : place.channelId,
                        userId: place === 'solo' ? me() : null,
                        focusMinutes: 25,
                        shortBreakMinutes: 5,
                        status: 'ended',
                        phase: 'focus',
                        phaseIndex: 0,
                        phaseStartedAt: first,
                        startedAt: first,
                        endedAt: new Date(joins.at(-1)![1] ?? joins.at(-1)![0]),
                        endedReason: 'stopped'
                    }
                })
                seeded.push(session.id)
                await prisma.participation.createMany({
                    data: joins.map(([joinedAt, leftAt, seconds]) => ({
                        sessionId: session.id,
                        userId: me(),
                        joinedAt: new Date(joinedAt),
                        leftAt: leftAt === null ? null : new Date(leftAt),
                        countedUntil: new Date(leftAt ?? joinedAt),
                        seconds
                    }))
                })
                return session.id
            }

            async function clear() {
                await prisma.focusSession.deleteMany({ where: { id: { in: seeded.splice(0) } } })
                await prisma.dailyStudy.deleteMany({ where: { userId: me() } })
                await prisma.streak.deleteMany({ where: { userId: me() } })
            }
            beforeEach(clear)
            afterEach(clear)

            it('gives a week gone by from DailyStudy: every day, the split, the week before, the grid, the best other week', async () => {
                const today = localDateOf(new Date(), 'Asia/Ho_Chi_Minh')
                await days([
                    ['2026-09-07', 0, 0], // a row with nothing counted: not a day with seconds
                    ['2026-09-14', 10, 0], // the first day with seconds
                    ['2026-10-05', 20, 0],
                    ['2026-10-11', 0, 40], // a Sunday: the week of Monday 05/10
                    ['2026-10-13', 50, 0],
                    ['2026-10-14', 0, 40],
                    ['2026-10-18', 31, 14],
                    [today, 0, 7]
                ])
                await prisma.streak.create({
                    data: {
                        userId: me(),
                        current: 2,
                        longest: 5,
                        lastQualifiedDate: new Date(`${today}T00:00:00.000Z`)
                    }
                })

                const res = await read('study-stats?view=week&date=2026-10-14')
                expect(res.status).toBe(200)
                const stats = res.body.data
                expect(stats).toMatchObject({
                    view: 'week',
                    today,
                    period: { start: '2026-10-12', end: '2026-10-18' },
                    total_seconds: 135 * 60,
                    room_seconds: 81 * 60,
                    solo_seconds: 54 * 60,
                    previous_seconds: 60 * 60,
                    previous_period_seconds: 60 * 60,
                    average_seconds: Math.floor((135 * 60) / 7),
                    all_time_seconds: 212 * 60,
                    first_date: '2026-09-14',
                    streak: { current: 2, longest: 5 },
                    today_seconds: 7 * 60,
                    best_other_week_seconds: 60 * 60
                })
                expect(stats.days).toHaveLength(7)
                expect(stats.days[0]).toEqual({
                    date: '2026-10-12',
                    focused_seconds: 0,
                    room_seconds: 0,
                    solo_seconds: 0
                })
                expect(stats.days[6]).toEqual({
                    date: '2026-10-18',
                    focused_seconds: 45 * 60,
                    room_seconds: 31 * 60,
                    solo_seconds: 14 * 60
                })
                expect(stats.grid).toHaveLength(28)
                expect(stats.grid[0]).toEqual({ date: '2026-09-21', focused_seconds: 0 })
                expect(stats.grid.find((one: { date: string }) => one.date === '2026-10-11').focused_seconds).toBe(
                    40 * 60
                )
            })

            it('gives a month, with no grid and no best week; the first period with seconds compares with nothing', async () => {
                await days([
                    ['2026-09-14', 10, 0],
                    ['2026-10-05', 20, 0],
                    ['2026-10-13', 50, 0]
                ])
                const month = (await read('study-stats?view=month&date=2026-10-20')).body.data
                expect(month).toMatchObject({
                    period: { start: '2026-10-01', end: '2026-10-31' },
                    total_seconds: 70 * 60,
                    previous_seconds: 10 * 60,
                    previous_period_seconds: 10 * 60,
                    grid: null,
                    best_other_week_seconds: null
                })
                expect(month.days).toHaveLength(31)
                const first = (await read('study-stats?view=week&date=2026-09-16')).body.data
                expect([first.previous_seconds, first.previous_period_seconds, first.best_other_week_seconds]).toEqual([
                    null,
                    null,
                    null
                ])
            })

            it('starts from this week in one’s zone, and gives a new account nothing', async () => {
                const stats = (await read('study-stats')).body.data
                expect(stats.period.start <= stats.today && stats.today <= stats.period.end).toBe(true)
                expect(stats).toMatchObject({
                    view: 'week',
                    total_seconds: 0,
                    first_date: null,
                    previous_seconds: null,
                    counted_until: null
                })
                expect(stats.streak).toEqual({ current: 0, longest: 0 })
            })

            it('gives where the count of the session Phong is in stands, and none once he left it (D-231)', async () => {
                const today = localDateOf(new Date(), 'Asia/Ho_Chi_Minh')
                await days([[today, 0, 12]])
                await pastSession('solo', [['2026-10-18T13:00:00.000Z', '2026-10-18T13:20:00.000Z', 1200]])
                const open = await pastSession('solo', [['2026-10-20T13:00:00.000Z', null, 0]])
                const before = Date.now() - 1000
                const told = (await read('study-stats')).body.data
                expect(told).toMatchObject({ today_seconds: 12 * 60, counted_until: '2026-10-20T13:00:00.000Z' })
                // When the two were read, by the database's clock (D-232).
                expect(Date.parse(told.read_at)).toBeGreaterThan(before)
                expect(Date.parse(told.read_at)).toBeLessThan(Date.now() + 1000)
                await prisma.participation.updateMany({
                    where: { sessionId: open },
                    data: { leftAt: new Date('2026-10-20T13:30:00.000Z') }
                })
                expect((await read('study-stats')).body.data.counted_until).toBeNull()
            })

            it('refuses a view or a day that is none', async () => {
                for (const query of [
                    'view=year',
                    'date=2026-02-30',
                    'date=18/10/2026',
                    'date=9999-12-31',
                    'cursor=abc'
                ]) {
                    const res = await read(`study-sessions?${query}`)
                    expect([query, res.status, res.body.meta?.type]).toEqual([query, 422, 'VALIDATION_ERROR'])
                }
            })

            it('gives each session of the week once, the latest first join first, its room named as Phong may know it (D-230)', async () => {
                const inRoom = { serverId, channelId: room }
                const doomed = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                    .set('Idempotency-Key', randomUUID())
                    .send({
                        type: 'voice',
                        name: 'Phòng sắp xóa',
                        is_study_room: true,
                        is_private: false,
                        view_role_ids: []
                    })
                const hidden = await as('an', api().post(`/api/v1/servers/${serverId}/channels`))
                    .set('Idempotency-Key', randomUUID())
                    .send({
                        type: 'voice',
                        name: 'Phòng riêng',
                        is_study_room: true,
                        is_private: true,
                        view_role_ids: []
                    })

                const twice = await pastSession(inRoom, [
                    ['2026-10-13T20:00:00+07:00', '2026-10-13T20:30:00+07:00', 1500],
                    ['2026-10-13T20:40:00+07:00', '2026-10-13T21:00:00+07:00', 1200]
                ])
                const alone = await pastSession('solo', [
                    ['2026-10-14T19:00:00+07:00', '2026-10-14T19:40:00+07:00', 2400]
                ])
                await pastSession(inRoom, [['2026-10-15T20:00:00+07:00', '2026-10-15T20:03:00+07:00', 0]]) // nothing counted
                const deleted = await pastSession({ serverId, channelId: doomed.body.data.id }, [
                    ['2026-10-16T20:00:00+07:00', '2026-10-16T20:30:00+07:00', 1500]
                ])
                const unseen = await pastSession({ serverId, channelId: hidden.body.data.id }, [
                    ['2026-10-17T20:00:00+07:00', '2026-10-17T20:30:00+07:00', 1500]
                ])
                const gone = await pastSession({ serverId: randomUUID(), channelId: randomUUID() }, [
                    ['2026-10-18T20:00:00+07:00', '2026-10-18T20:30:00+07:00', 1500]
                ])
                // Sunday 23:30 of the week before, back on Monday: a line of that week only.
                const acrossMidnight = await pastSession(inRoom, [
                    ['2026-10-11T23:30:00+07:00', '2026-10-11T23:50:00+07:00', 1200],
                    ['2026-10-12T00:30:00+07:00', '2026-10-12T00:40:00+07:00', 600]
                ])
                await as('an', api().delete(`/api/v1/servers/${serverId}/channels/${doomed.body.data.id}`))

                const res = await read('study-sessions?view=week&date=2026-10-14')
                expect(res.status).toBe(200)
                const lines = res.body.data.items
                expect(lines.map((line: { session_id: string }) => line.session_id)).toEqual([
                    gone,
                    unseen,
                    deleted,
                    alone,
                    twice
                ])
                expect(
                    lines.map((line: Record<string, unknown>) => [line.room_name, line.room_deleted, line.server_name])
                ).toEqual([
                    [null, false, null],
                    [null, false, 'Nhóm ôn thi'],
                    [null, true, 'Nhóm ôn thi'],
                    [null, false, null],
                    ['Phòng học im lặng', false, 'Nhóm ôn thi']
                ])
                expect(lines[4]).toMatchObject({
                    kind: 'room',
                    first_joined_at: '2026-10-13T13:00:00.000Z',
                    last_left_at: '2026-10-13T14:00:00.000Z',
                    seconds: 2700,
                    join_count: 2
                })
                expect(lines[3]).toMatchObject({ kind: 'solo', seconds: 2400, join_count: 1 })
                expect(res.body.data.has_more).toBe(false)

                const before = (await read('study-sessions?view=week&date=2026-10-08')).body.data.items
                expect(before.map((line: { session_id: string }) => line.session_id)).toEqual([acrossMidnight])
                expect(before[0]).toMatchObject({ seconds: 1800, join_count: 2 })
            })

            it('pages 20 lines at a time after the last line’s session, two with the same first join kept apart by id', async () => {
                const made: string[] = []
                for (let i = 0; i < 22; i++) {
                    // Lines 20 and 21 (the 2 oldest) start at the same second.
                    const at = new Date(Date.parse('2026-10-20T01:00:00.000Z') + Math.max(i, 1) * 600_000)
                    const left = new Date(at.getTime() + 300_000)
                    made.push(await pastSession('solo', [[at.toISOString(), left.toISOString(), 300]]))
                }
                const newestFirst = [...made].reverse()
                // The two oldest share their first join: the greater id comes first.
                newestFirst.splice(20, 2, ...[made[0], made[1]].sort().reverse())

                const first = (await read('study-sessions?date=2026-10-21')).body.data
                expect(first.items.map((line: { session_id: string }) => line.session_id)).toEqual(
                    newestFirst.slice(0, 20)
                )
                expect(first.has_more).toBe(true)
                const second = (await read(`study-sessions?date=2026-10-21&cursor=${first.items[19].session_id}`)).body
                    .data
                expect(second.items.map((line: { session_id: string }) => line.session_id)).toEqual(
                    newestFirst.slice(20)
                )
                expect(second.has_more).toBe(false)
                const middle = (await read(`study-sessions?date=2026-10-21&cursor=${newestFirst[20]}`)).body.data
                expect(middle.items.map((line: { session_id: string }) => line.session_id)).toEqual([newestFirst[21]])

                const stale = await read(`study-sessions?date=2026-10-21&cursor=${randomUUID()}`)
                expect([stale.status, stale.body.meta?.type]).toEqual([409, 'CONFLICT_ERROR'])
            })

            it('gives the session one is in once, first, its joins added, even with seconds counted', async () => {
                const other = await pastSession('solo', [
                    ['2026-10-14T19:00:00+07:00', '2026-10-14T19:40:00+07:00', 2400]
                ])
                const inIt = await pastSession({ serverId, channelId: room }, [
                    ['2026-10-14T18:00:00+07:00', '2026-10-14T18:30:00+07:00', 1500],
                    ['2026-10-14T20:00:00+07:00', null, 600]
                ])
                const lines = (await read('study-sessions?date=2026-10-14')).body.data.items
                expect(lines.map((line: { session_id: string }) => line.session_id)).toEqual([inIt, other])
                expect(lines[0]).toMatchObject({ last_left_at: null, seconds: 2100, join_count: 2 })
            })

            it('gives the session one is in only in the week of one’s first join: Sunday 23:50 is the week before', async () => {
                const inIt = await pastSession({ serverId, channelId: room }, [
                    ['2026-10-11T23:50:00+07:00', null, 600]
                ])
                const ids = async (date: string) =>
                    (await read(`study-sessions?date=${date}`)).body.data.items.map(
                        (line: { session_id: string }) => line.session_id
                    )
                expect(await ids('2026-10-14')).toEqual([])
                expect(await ids('2026-10-08')).toEqual([inIt])
            })

            it('puts the session one is in first, with no second yet, only on the first page', async () => {
                const past = await pastSession('solo', [
                    ['2026-10-14T19:00:00+07:00', '2026-10-14T19:40:00+07:00', 2400]
                ])
                const started = await as('phong', api().post('/api/v1/me/solo-session'))
                    .set('Idempotency-Key', randomUUID())
                    .send({})
                expect(started.status).toBe(201)
                const lines = (await read('study-sessions')).body.data.items
                expect(lines[0]).toMatchObject({
                    session_id: started.body.data.id,
                    kind: 'solo',
                    last_left_at: null,
                    seconds: 0,
                    join_count: 1
                })
                const later = (await read(`study-sessions?cursor=${past}`)).body.data.items
                expect(later.map((line: { session_id: string }) => line.session_id)).not.toContain(started.body.data.id)
                // Not in a week other than the one of its first join.
                const october = (await read('study-sessions?date=2026-10-14')).body.data.items
                expect(october.map((line: { session_id: string }) => line.session_id)).toEqual([past])
            })
        })

        describe('a job across a restart (NFR-REL-02)', () => {
            it('ends a phase whose job was set before the app stopped, once it is back', async () => {
                await enter(room, 'an')
                const id = (await start('an', room)).body.data.id as string
                // Due in 2 seconds: its job, set again for then, waits in Redis while no app runs.
                await studyQueue().remove(`focus-${id}-0`)
                await rewind(id, 25 * 60 - 2)
                const due = (await prisma.focusSession.findUniqueOrThrow({ where: { id } })).phaseEndsAt!
                await app.get<SessionJobsPort>(SESSION_JOBS).endPhaseAt(id, 0, due)

                await closeApp(app)
                await new Promise((resolve) => setTimeout(resolve, 3000))
                app = await bootApp()
                prisma = app.get(PrismaService)

                let session = await prisma.focusSession.findUniqueOrThrow({ where: { id } })
                for (let i = 0; i < 100 && session.phase === 'focus'; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 100))
                    session = await prisma.focusSession.findUniqueOrThrow({ where: { id } })
                }
                expect(session).toMatchObject({ phase: 'short_break', version: 1, phaseStartedAt: due })
            })
        })
    })
})
