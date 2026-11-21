import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort, StudyRoomSettings } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { VoiceRoomsPort } from '@/modules/voice'
import {
    closesStretch,
    firstClock,
    FocusSession,
    FocusSessionActiveError,
    FocusSessionRepositoryPort,
    joinMove,
    MayHost,
    PresenceChange,
    presenceMove,
    SessionChange,
    stopMove,
    stretchAfter,
    StudyCount,
    StudyForbiddenError,
    ZoneOf
} from '../domain'
import { SessionJobsPort } from './ports'
import { StudySettings } from './study-settings'

/*
 * One server for the study handler specs, in memory (spec 07 › thế giới A):
 * An the owner, Bình and Phong members, Chi "Điều phối phòng học"
 * (MANAGE_STUDY_ROOMS), Dũng timed out for an hour, Khách not a member.
 * Rooms: "phong-hoc" a study room anyone starts in, "phong-thi" one only
 * managers start in, "tan-gau" a voice room that is no study room,
 * "bi-mat" a private study room only Chi's role sees, and a text channel.
 */

export const NOW = new Date('2026-11-21T20:00:00.000Z')
export const MINUTE = 60_000

const room = (id: string) => ({
    id,
    type: 'voice' as const,
    isPrivate: false,
    viewRoleIds: [],
    sendMode: 'everyone' as const,
    taskBoardEnabled: false
})

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'dieu-phoi', permissions: Permission.MANAGE_STUDY_ROOMS, position: 1, isEveryone: false }
    ],
    channels: [
        room('phong-hoc'),
        room('phong-thi'),
        room('tan-gau'),
        { ...room('bi-mat'), isPrivate: true, viewRoleIds: ['dieu-phoi'] },
        { ...room('hoi-dap'), type: 'text' }
    ]
}

const MEMBERS = ['an', 'binh', 'chi', 'dung', 'phong']

const study = (studyStarter: 'anyone' | 'managers', isStudyRoom = true): StudyRoomSettings => ({
    serverId: 'ot',
    isStudyRoom,
    studyStarter,
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: null,
    longBreakEvery: null
})

const ROOMS: Record<string, StudyRoomSettings> = {
    'phong-hoc': study('anyone'),
    'phong-thi': study('managers'),
    'tan-gau': study('anyone', false),
    'bi-mat': study('anyone')
}

/** A Room Session of `channelId` started at NOW by An, 25/5, running its first focus phase. */
export function roomSession(shape: Partial<FocusSession> = {}): FocusSession {
    const cycle = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: null, longBreakEvery: null }
    return {
        id: 'phien',
        kind: 'room',
        serverId: 'ot',
        channelId: 'phong-hoc',
        hostId: 'an',
        userId: null,
        cycle,
        version: 0,
        startedAt: NOW,
        stretchStartedAt: NOW,
        emptySince: null,
        ...firstClock(cycle, NOW, MINUTE),
        ...shape
    }
}

/** An's Solo started at NOW, 25/5, running its first focus phase. */
export function soloSession(shape: Partial<FocusSession> = {}): FocusSession {
    return roomSession({
        id: 'solo',
        kind: 'solo',
        channelId: null,
        serverId: null,
        hostId: null,
        userId: 'an',
        ...shape
    })
}

/** One session as each change leaves it: running, paused, ended; and a Solo. */
export const SESSIONS = (() => {
    const running = roomSession()
    const paused: FocusSession = {
        ...running,
        status: 'paused',
        phaseEndsAt: null,
        pausedRemainingMs: MINUTE,
        version: 1
    }
    const ended: FocusSession = {
        ...running,
        status: 'ended',
        phaseEndsAt: null,
        endedAt: NOW,
        endedReason: 'stopped',
        version: 1
    }
    const solo: FocusSession = { ...running, kind: 'solo', channelId: null, serverId: null, hostId: null, userId: 'an' }
    return { running, paused, ended, solo }
})()

/** A count of `userId` as the repository makes it. */
const countOf = (userId: string, sessionId: string, timeZone: string): StudyCount & { timeZone: string } => ({
    userId,
    sessionId,
    added: 60,
    seconds: 60,
    countedUntil: NOW,
    todaySeconds: 60,
    streak: { current: 0, longest: 0, lastQualifiedDate: null },
    shownStreak: 0,
    timeZone
})

/**
 * The sessions, kept as the Prisma repository keeps them: a change decided
 * on the session as it is, at `at` (NOW unless set), with the version the
 * client saw; a closed stretch counts every participant. Who takes part:
 * `participants` (open places, by session, in the order they came), `away`
 * (`<sessionId>:<userId>` of those away, and since when); a participation's
 * id is that key too.
 */
export function studyWorld() {
    const sessions = new Map<string, FocusSession>()
    const participants = new Map<string, string[]>()
    const inRoom = new Map<string, string>([
        ['an', 'phong-hoc'],
        ['binh', 'phong-hoc'],
        ['phong', 'phong-hoc'],
        ['chi', 'phong-thi']
    ])
    const away = new Map<string, Date>()
    let at = NOW
    const placeOf = (sessionId: string, userId: string) => `${sessionId}:${userId}`
    const present = (sessionId: string) =>
        (participants.get(sessionId) ?? []).filter((userId) => !away.has(placeOf(sessionId, userId)))
    const write = (id: string, shape: Partial<FocusSession>) => {
        const after = { ...sessions.get(id)!, ...shape }
        sessions.set(id, after)
        return after
    }

    /**
     * One person away or gone, decided by presenceMove as the repository does:
     * those present came in the order `participants` lists them (joinedAt a
     * millisecond apart), every one of them asked whether they may be Host.
     */
    const changePresence = async (
        sessionId: string,
        userId: string,
        what: 'away' | 'leave',
        mayHost: MayHost,
        zoneOf: ZoneOf
    ): Promise<PresenceChange> => {
        const before = sessions.get(sessionId)!
        const place = placeOf(sessionId, userId)
        const people = participants.get(sessionId) ?? []
        const others = present(sessionId)
            .filter((id) => id !== userId)
            .map((id) => ({ userId: id, joinedAt: new Date(NOW.getTime() + people.indexOf(id)) }))
        const asked = new Map<string, boolean>()
        for (const other of others) asked.set(other.userId, await mayHost(before.channelId!, other.userId))
        const move = presenceMove(
            before,
            { userId, awaySince: away.get(place) ?? null, countedUntil: NOW },
            what,
            at,
            others,
            asked
        )!
        const counts: StudyCount[] = []
        if ('awaySince' in move.place) {
            away.set(place, move.place.awaySince)
        } else {
            away.delete(place)
            participants.set(
                sessionId,
                people.filter((id) => id !== userId)
            )
            counts.push(countOf(userId, sessionId, await zoneOf(userId)))
        }
        const changed = move.hostId !== before.hostId
        const after = write(sessionId, {
            ...(changed && { hostId: move.hostId, version: before.version + 1 }),
            ...(move.emptySince && { emptySince: move.emptySince })
        })
        return {
            before,
            after,
            changed,
            counts,
            summaries: null,
            away: 'awaySince' in move.place ? { participationId: place, since: move.place.awaySince } : null,
            emptySince: move.emptySince
        }
    }
    const openIn = (channelId: string) =>
        [...sessions.values()].find((session) => session.channelId === channelId && session.status !== 'ended')
    const sessionOf = (userId: string) =>
        [...participants].find(([id, people]) => people.includes(userId) && sessions.get(id)?.status !== 'ended')?.[0]

    /** Ends a Solo as its person takes part in a Room Session at `at` (D-103): counted, closed, as `joined_room`. */
    const yieldSolo = async (soloId: string, zoneOf: ZoneOf): Promise<SessionChange> => {
        const before = sessions.get(soloId)!
        const move = stopMove(before, at, 'joined_room')!
        const after = write(soloId, { ...move.clock, version: before.version + 1, stretchStartedAt: null })
        const userId = before.userId!
        return {
            before,
            after,
            changed: true,
            counts: [countOf(userId, soloId, await zoneOf(userId))],
            summaries: [{ userId, seconds: 60 }]
        }
    }
    const soloOf = (userId: string) => {
        const id = sessionOf(userId)
        return id && sessions.get(id)!.kind === 'solo' ? id : undefined
    }

    const repository: FocusSessionRepositoryPort = {
        find: jest.fn(async (id: string) => sessions.get(id) ?? null),
        openInRooms: jest.fn(
            async (channelIds: string[]) =>
                new Map(
                    [...sessions.values()]
                        .filter((session) => channelIds.includes(session.channelId!) && session.status !== 'ended')
                        .map((session) => [session.channelId!, session])
                )
        ),
        openSolo: jest.fn(async (userId: string) => {
            const id = soloOf(userId)
            return id ? sessions.get(id)! : null
        }),
        lastSoloCycle: jest.fn(async (userId: string) => {
            const solos = [...sessions.values()].filter((session) => session.userId === userId)
            solos.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
            return solos[0]?.cycle ?? null
        }),
        startSolo: jest.fn(async ({ userId, cycle, minuteMs }) => {
            if (sessionOf(userId)) throw new FocusSessionActiveError(`person ${userId}`)
            const session = soloSession({
                id: `solo-${sessions.size + 1}`,
                userId,
                cycle,
                ...firstClock(cycle, at, minuteMs),
                startedAt: at,
                stretchStartedAt: at
            })
            sessions.set(session.id, session)
            participants.set(session.id, [userId])
            return session
        }),
        startInRoom: jest.fn(async (start, peopleIn, zoneOf) => {
            const open = [...sessions.values()].some(
                (session) => session.channelId === start.channelId && session.status !== 'ended'
            )
            if (open) throw new FocusSessionActiveError(`room ${start.channelId}`)
            const session = roomSession({
                id: `phien-${sessions.size + 1}`,
                channelId: start.channelId,
                hostId: start.hostId,
                cycle: start.cycle,
                ...firstClock(start.cycle, at, start.minuteMs),
                startedAt: at,
                stretchStartedAt: at
            })
            sessions.set(session.id, session)
            const people = (await peopleIn()).sort()
            // Its Host takes part, or there is no session (the Prisma repository rolls it back).
            if (!people.includes(start.hostId)) throw new StudyForbiddenError('not_in_room')
            const yielded: SessionChange[] = []
            for (const userId of people) {
                const solo = soloOf(userId)
                if (solo) yielded.push(await yieldSolo(solo, zoneOf))
            }
            participants.set(session.id, people)
            return { session, participantIds: participants.get(session.id)!, yielded }
        }),
        change: jest.fn(async (id, version, decide, zoneOf) => {
            const before = sessions.get(id)
            if (!before) return null
            const move = version !== null && version !== before.version ? null : decide(before, at)
            if (!move) return { before, after: before, changed: false, counts: [], summaries: null }
            const ended = move.clock.status === 'ended'
            const after: FocusSession = {
                ...before,
                ...move.clock,
                cycle: move.cycle,
                version: before.version + 1,
                stretchStartedAt: ended ? null : stretchAfter(move, before.stretchStartedAt)
            }
            sessions.set(id, after)
            const counted = closesStretch(move) || ended ? (participants.get(id) ?? []) : []
            const counts = await Promise.all(counted.map(async (userId) => countOf(userId, id, await zoneOf(userId))))
            return {
                before,
                after,
                changed: true,
                counts,
                summaries: ended ? counted.map((userId) => ({ userId, seconds: 60 })) : null
            }
        }),
        overdue: jest.fn(async (now: Date, limit: number) =>
            [...sessions.values()]
                .filter(
                    (session) =>
                        (session.status === 'running' && session.phaseEndsAt! <= now) ||
                        (session.status === 'waiting' && session.waitingUntil! <= now)
                )
                .slice(0, limit)
                .map(({ id, version }) => ({ id, version }))
        ),
        openInServer: jest.fn(async (serverId: string) =>
            [...sessions.values()].filter((session) => session.serverId === serverId && session.status !== 'ended')
        ),
        joinRoom: jest.fn(async (channelId: string, userId: string, mayHost: boolean | null, zone: string | null) => {
            const session = openIn(channelId)
            const solo = soloOf(userId)
            const elsewhere = solo ? undefined : sessionOf(userId)
            if (elsewhere && elsewhere !== session?.id) return { kind: 'elsewhere' as const, sessionId: elsewhere }
            if (!session) return { kind: 'no_session' as const }
            if (solo && zone === null) return { kind: 'zone' as const }
            const move = joinMove(
                session,
                elsewhere ? { awaySince: away.get(placeOf(session.id, userId)) ?? null } : null,
                mayHost
            )
            if (move === 'ask') return { kind: 'ask' as const }
            const yielded = solo ? await yieldSolo(solo, async () => zone!) : null
            if (move.opens) participants.set(session.id, [...(participants.get(session.id) ?? []), userId])
            if (move.back) away.delete(placeOf(session.id, userId))
            const after = write(session.id, {
                ...(move.endsEmptiness && { emptySince: null }),
                ...(move.becomesHost && { hostId: userId, version: session.version + 1 })
            })
            return {
                kind: 'joined' as const,
                change: {
                    before: session,
                    after,
                    changed: move.becomesHost,
                    counts: [],
                    summaries: null,
                    away: null,
                    emptySince: null
                },
                yielded
            }
        }),
        leave: jest.fn(async (from, userId, lost, mayHost, zoneOf) => {
            const sessionId =
                'channelId' in from
                    ? openIn(from.channelId)?.id
                    : 'sessionId' in from
                      ? from.sessionId
                      : sessionOf(userId)
            if (!sessionId || !(participants.get(sessionId) ?? []).includes(userId)) return null
            if (lost && away.has(placeOf(sessionId, userId))) return null
            return changePresence(sessionId, userId, lost ? 'away' : 'leave', mayHost, zoneOf)
        }),
        closeAway: jest.fn(async (participationId: string, since: Date, mayHost: MayHost, zoneOf: ZoneOf) => {
            if (away.get(participationId)?.getTime() !== since.getTime()) return null
            const [sessionId, userId] = participationId.split(':')
            return changePresence(sessionId, userId, 'leave', mayHost, zoneOf)
        }),
        emptySince: jest.fn(async (before: Date, limit: number) =>
            [...sessions.values()]
                .filter((session) => session.emptySince && session.emptySince <= before)
                .slice(0, limit)
                .map(({ id, emptySince }) => ({ id, emptySince: emptySince! }))
        ),
        awaySince: jest.fn(async (before: Date, limit: number) =>
            [...away]
                .filter(([, since]) => since <= before)
                .slice(0, limit)
                .map(([id, since]) => ({ id, awaySince: since }))
        ),
        openRooms: jest.fn(async () =>
            [...sessions.values()]
                .filter((session) => session.kind === 'room' && session.status !== 'ended')
                .map((session) => ({
                    sessionId: session.id,
                    channelId: session.channelId!,
                    present: [...present(session.id)].sort()
                }))
        )
    }

    const channels: ChannelDirectoryPort = {
        serverIdOf: async (channelId) => (ROOMS[channelId] || channelId === 'hoi-dap' ? 'ot' : null),
        channelIdsOf: async () => [],
        studyRoomOf: async (channelId) => ROOMS[channelId] ?? null
    }
    const checker: PermissionCheckerPort = {
        access: async (_serverId, userId) =>
            MEMBERS.includes(userId)
                ? {
                      server,
                      member: {
                          userId,
                          roleIds: userId === 'chi' ? ['dieu-phoi'] : [],
                          timeoutUntil: userId === 'dung' ? new Date(Date.now() + 3600_000) : null
                      }
                  }
                : null
    }
    const voiceRooms: VoiceRoomsPort = {
        peopleIn: jest.fn(async (channelId: string) =>
            [...inRoom]
                .filter(([, where]) => where === channelId)
                .map(([userId]) => ({ userId, channelId, joinedAt: NOW }))
        ),
        roomOf: async (userId: string) => {
            const channelId = inRoom.get(userId)
            return channelId ? { userId, channelId, joinedAt: NOW } : null
        }
    }
    const users = {
        timeZoneOf: jest.fn(async (userId: string) => (userId === 'an' ? 'Asia/Ho_Chi_Minh' : null))
    } as unknown as UserDirectoryPort
    const events = { publish: jest.fn() } as unknown as EventBus & { publish: jest.Mock }
    const jobs: SessionJobsPort & {
        endPhaseAt: jest.Mock
        dropPhaseEnd: jest.Mock
        closeAwayAt: jest.Mock
        endEmptyAt: jest.Mock
    } = {
        endPhaseAt: jest.fn(async () => undefined),
        dropPhaseEnd: jest.fn(async () => undefined),
        closeAwayAt: jest.fn(async () => undefined),
        endEmptyAt: jest.fn(async () => undefined)
    }
    const settings: StudySettings = { minuteMs: MINUTE }

    return {
        sessions,
        participants,
        away,
        inRoom,
        repository,
        channels,
        checker,
        voiceRooms,
        users,
        events,
        jobs,
        settings,
        /** Makes the next changes at `time`. */
        at: (time: Date) => {
            at = time
        },
        /** A session put in the store as it is, with these participants. */
        put: (session: FocusSession, people: string[] = ['an', 'binh']) => {
            sessions.set(session.id, session)
            participants.set(session.id, people)
            return session
        },
        /** The events published, by class name. */
        published: () => events.publish.mock.calls.map(([event]) => event as object)
    }
}
