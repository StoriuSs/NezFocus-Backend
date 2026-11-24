import { EventBus } from '@nestjs/cqrs'
import type { LastMessage, LastMessagesPort } from '@/modules/messaging'
import { Presence, PresencePort } from '@/modules/realtime'
import { ChannelDirectoryPort, MembershipPort, SharedServer } from '@/modules/servers'
import type { SoloSessionsPort, SoloState } from '@/modules/study'
import { DirectoryUser, StudyActivitySettings, UserDirectoryPort } from '@/modules/users'
import type { CallConnection, CallMediaPort, RoomOccupancy, VoiceRoomsPort } from '@/modules/voice'
import { isHidden, LimitsUnavailableError, shownPerson } from '@/shared/domain'
import { RateLimitRule } from '@/shared/types/rate-limit.type'
import {
    afterWrite,
    Call,
    CallPlan,
    CallPresence,
    CallRecord,
    CallRepositoryPort,
    ChangedCall,
    DmEntry,
    DmRepositoryPort,
    isOpenCall,
    MediaWrite,
    PairState,
    RelationshipDecision,
    RelationshipEntry,
    RelationshipRepositoryPort,
    Standing
} from '../domain'
import { CallJobsPort, SocialLimitPort } from './ports'
import { StudyActivities } from './services/activities'

/*
 * People for the social handler specs, in memory (spec 09): An, Bình, Chi,
 * Dũng completed; Giang waiting to be deleted; Hà deleted for good; Khoa
 * never completed. An and Bình share the server "ot", Bình and Chi the
 * server "nd". Times in Hồ Chí Minh City for An. Everyone lets server
 * members message them until a test says otherwise (`allowing`). DMs and
 * their last messages as the Prisma repository and messaging keep them,
 * on a clock a test moves (`clock`). Study activity (D-247): the server "ot"
 * has the study room "phong-hoc" and the voice room "phong-voice", "nd"
 * the study room "phong-nd"; nobody is in a room or a Solo until a test
 * puts them there (`inRoom`, `solos`); everyone completed shows activity
 * until a test changes `activitySettings`.
 */

const NAMES = ['an', 'binh', 'chi', 'dung', 'giang', 'ha', 'khoa'] as const

const person = (id: string, extra: Partial<DirectoryUser> = {}): DirectoryUser => ({
    id,
    email: `${id}@example.test`,
    roles: ['USER'],
    username: id,
    displayName: id.toUpperCase(),
    avatarUrl: `${id}.png`,
    bio: `Bio of ${id}`,
    completedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    deletionRequestedAt: null,
    ...extra
})

/** The relationships and blocks, as the Prisma repository keeps them (one row a pair, blocks one way). */
export function socialWorld() {
    const people = new Map<string, DirectoryUser>(NAMES.map((id) => [id, person(id)]))
    people.set('giang', person('giang', { deletionRequestedAt: new Date('2026-11-20T00:00:00Z') }))
    people.set('ha', person('ha', { deletedAt: new Date('2026-11-01T00:00:00Z'), username: null }))
    people.set('khoa', person('khoa', { completedAt: null, username: null }))

    const key = (a: string, b: string) => [a, b].sort().join('|')
    /** Pair key → requester, status, note, times. */
    const rows = new Map<
        string,
        { requesterId: string; accepted: boolean; note: string | null; createdAt: Date; acceptedAt: Date | null }
    >()
    /** Blocker|blocked → when. */
    const blocks = new Map<string, Date>()

    const stateOf = (actorId: string, otherId: string): PairState => {
        const row = rows.get(key(actorId, otherId))
        const standing: Standing = !row
            ? 'none'
            : row.accepted
              ? 'friend'
              : row.requesterId === actorId
                ? 'outgoing'
                : 'incoming'
        return {
            standing,
            blocking: blocks.has(`${actorId}|${otherId}`),
            blockedBy: blocks.has(`${otherId}|${actorId}`)
        }
    }
    const entryOf = (viewerId: string, otherId: string): RelationshipEntry | null => {
        const other = people.get(otherId)
        if (!other || other.deletedAt) return null
        const shown = shownPerson(other)
        const blockedAt = blocks.get(`${viewerId}|${otherId}`)
        if (blockedAt) return { person: shown, type: 'blocked', note: null, since: blockedAt }
        const row = rows.get(key(viewerId, otherId))
        const { standing } = stateOf(viewerId, otherId)
        if (!row) return { person: shown, type: 'none', note: null, since: null }
        return {
            person: shown,
            type: standing,
            note: standing === 'incoming' || standing === 'outgoing' ? row.note : null,
            since: row.acceptedAt ?? row.createdAt
        }
    }

    const relationships: RelationshipRepositoryPort = {
        change: jest.fn(
            async (actorId: string, otherId: string, decide: (state: PairState) => RelationshipDecision, at: Date) => {
                const before = stateOf(actorId, otherId)
                const decision = decide(before)
                if ('refused' in decision) return { before, after: before, decision }
                const pair = key(actorId, otherId)
                if (decision.write === 'request') {
                    rows.set(pair, {
                        requesterId: actorId,
                        accepted: false,
                        note: decision.note,
                        createdAt: at,
                        acceptedAt: null
                    })
                } else if (decision.write === 'accept') {
                    rows.set(pair, { ...rows.get(pair)!, accepted: true, note: null, acceptedAt: at })
                } else if (decision.write === 'remove') {
                    rows.delete(pair)
                } else if (decision.write === 'block') {
                    rows.delete(pair)
                    blocks.set(`${actorId}|${otherId}`, at)
                } else if (decision.write === 'unblock') {
                    blocks.delete(`${actorId}|${otherId}`)
                }
                return { before, after: afterWrite(before, decision), decision }
            }
        ),
        entriesOf: jest.fn(async (userId: string) =>
            [...people.keys()]
                .filter((id) => id !== userId)
                .map((id) => entryOf(userId, id))
                .filter((entry): entry is RelationshipEntry => !!entry && entry.type !== 'none')
        ),
        entryOf: jest.fn(async (viewerId: string, otherId: string) => entryOf(viewerId, otherId)),
        friendIdsOf: jest.fn(async (userId: string) =>
            [...people.keys()].filter((id) => id !== userId && stateOf(userId, id).standing === 'friend')
        ),
        blockedBy: jest.fn(async (userId: string) =>
            [...blocks.keys()].filter((pair) => pair.startsWith(`${userId}|`)).map((pair) => pair.split('|')[1]!)
        ),
        blockersAmong: jest.fn(async (blockedId: string, userIds: string[]) =>
            userIds.filter((id) => blocks.has(`${id}|${blockedId}`))
        ),
        forgetAccount: jest.fn(async () => [])
    }

    const zones = new Map<string, string>([['an', 'Asia/Ho_Chi_Minh']])
    /** The two settings of each one's activity line, as users keeps them (D-247). */
    const activitySettings = new Map<string, StudyActivitySettings>(
        NAMES.map((id) => [id, { showStudyActivity: true, presence: 'online' }])
    )
    /** Who lets members of a server they share message them (on by default). */
    const allowing = new Set<string>(NAMES)
    const users = {
        findById: jest.fn(async (id: string) => people.get(id) ?? null),
        findByUsername: jest.fn(
            async (username: string) =>
                [...people.values()].find((one) => one.username === username && !one.deletedAt) ?? null
        ),
        timeZoneOf: jest.fn(async (id: string) => zones.get(id) ?? null),
        allowingServerMemberMessages: jest.fn(async (ids: string[]) =>
            ids.filter((id) => allowing.has(id) && people.get(id)?.completedAt && !people.get(id)?.deletedAt)
        ),
        studyActivitySettingsOf: jest.fn(
            async (ids: string[]) =>
                new Map(
                    ids.flatMap((id) => {
                        const one = people.get(id)
                        const settings = activitySettings.get(id)
                        return one?.completedAt && !isHidden(one) && settings ? [[id, { ...settings }] as const] : []
                    })
                )
        ),
        avatarUrl: jest.fn(async (key: string | null) => (key ? `https://cdn/${key}` : null))
    } as unknown as UserDirectoryPort & { findByUsername: jest.Mock }

    /** Counts kept per rule and subject, as RateLimiter keeps them. */
    const counts = new Map<string, number>()
    const counter = { down: false }
    const limit: SocialLimitPort & { hit: jest.Mock; release: jest.Mock } = {
        hit: jest.fn(async (rule: RateLimitRule, subject: string) => {
            if (counter.down) throw new LimitsUnavailableError()
            const count = (counts.get(`${rule.name}:${subject}`) ?? 0) + 1
            counts.set(`${rule.name}:${subject}`, count)
            return { count, limited: count > rule.limit, retryAfterSeconds: 42 }
        }),
        release: jest.fn(async (rule: RateLimitRule, subject: string) => {
            const count = counts.get(`${rule.name}:${subject}`) ?? 0
            if (count > 0) counts.set(`${rule.name}:${subject}`, count - 1)
        })
    }

    const online = new Map<string, Presence>([['binh', 'online']])
    const presence = {
        everyoneShown: jest.fn(async () => new Map(online)),
        connected: jest.fn()
    } as unknown as PresencePort

    const shared = new Map<string, SharedServer[]>([
        [key('an', 'binh'), [{ serverId: 'ot', name: 'Ôn thi Giải tích 2' }]],
        [key('binh', 'chi'), [{ serverId: 'nd', name: 'Nhóm đồ án' }]]
    ])
    const serversOf = new Map<string, string[]>([
        ['an', ['ot']],
        ['binh', ['ot', 'nd']],
        ['chi', ['nd']]
    ])
    const membership = {
        serverIdsOf: jest.fn(async (userId: string) => serversOf.get(userId) ?? []),
        sharedServers: jest.fn(async (viewerId: string, otherId: string) => shared.get(key(viewerId, otherId)) ?? []),
        sharingAServer: jest.fn(async (userId: string, otherIds: string[]) =>
            otherIds.filter((id) => (shared.get(key(userId, id)) ?? []).length > 0)
        )
    } as unknown as MembershipPort

    /** The database's clock, which stamps DMs, close marks and messages alike. */
    const clock = { now: new Date('2026-11-24T08:00:00Z') }
    const tick = () => (clock.now = new Date(clock.now.getTime() + 60_000))
    /** Channel id → the DmChannel row. */
    const dmRows = new Map<
        string,
        { low: string; high: string; lowClosedAt: Date | null; highClosedAt: Date | null; createdAt: Date }
    >()
    const dmOf = (a: string, b: string) => {
        const [low, high] = [a, b].sort()
        return [...dmRows].find(([, row]) => row.low === low && row.high === high)
    }
    const dmEntry = (userId: string, channelId: string): DmEntry | null => {
        const row = dmRows.get(channelId)
        if (!row || (row.low !== userId && row.high !== userId)) return null
        const low = row.low === userId
        const other = people.get(low ? row.high : row.low)!
        return {
            channelId,
            other: shownPerson(other),
            otherGone: isHidden(other),
            closedAt: low ? row.lowClosedAt : row.highClosedAt,
            createdAt: row.createdAt
        }
    }
    const dms: DmRepositoryPort = {
        findByPair: jest.fn(async (userId: string, otherId: string) => {
            const found = dmOf(userId, otherId)
            return found
                ? {
                      channelId: found[0],
                      userIds: [found[1].low, found[1].high] as [string, string],
                      createdAt: found[1].createdAt
                  }
                : null
        }),
        find: jest.fn(async (channelId: string) => {
            const row = dmRows.get(channelId)
            return row
                ? { channelId, userIds: [row.low, row.high] as [string, string], createdAt: row.createdAt }
                : null
        }),
        open: jest.fn(async (userId: string, otherId: string) => {
            const found = dmOf(userId, otherId)
            if (found) {
                const [channelId, row] = found
                const side = row.low === userId ? 'lowClosedAt' : 'highClosedAt'
                if (!row[side]) return { channelId, created: false, reopened: false }
                row[side] = null
                return { channelId, created: false, reopened: true }
            }
            const [low, high] = [userId, otherId].sort() as [string, string]
            const channelId = `dm-${low}-${high}`
            const now = tick()
            dmRows.set(channelId, {
                low,
                high,
                createdAt: now,
                lowClosedAt: low === userId ? null : now,
                highClosedAt: high === userId ? null : now
            })
            return { channelId, created: true, reopened: false }
        }),
        close: jest.fn(async (userId: string, channelId: string) => {
            const row = dmRows.get(channelId)
            if (!row || (row.low !== userId && row.high !== userId)) return null
            const side = row.low === userId ? 'lowClosedAt' : 'highClosedAt'
            if (row[side]) return false
            row[side] = tick()
            return true
        }),
        entriesOf: jest.fn(async (userId: string) =>
            [...dmRows.keys()].map((id) => dmEntry(userId, id)).filter((entry): entry is DmEntry => !!entry)
        ),
        entryOf: jest.fn(async (userId: string, channelId: string) => dmEntry(userId, channelId)),
        channelIdsOf: jest.fn(async (userId: string) =>
            [...dmRows].filter(([, row]) => row.low === userId || row.high === userId).map(([id]) => id)
        )
    }
    /** Channel id → its last message not deleted. */
    const lastSaid = new Map<string, LastMessage>()
    /** A message in a DM, now by the clock. */
    const say = (channelId: string, authorId: string, content = 'Chào nha') => {
        const at = tick()
        lastSaid.set(channelId, {
            channelId,
            id: `m-${at.getTime()}`,
            type: 'regular',
            systemEvent: null,
            authorId,
            content,
            mentionUsers: [],
            files: { count: 0, images: 0 },
            createdAt: at
        })
    }
    const lastMessages: LastMessagesPort & { lastMessagesOf: jest.Mock } = {
        lastMessagesOf: jest.fn(async (channelIds: string[]) =>
            channelIds.flatMap((id) => (lastSaid.has(id) ? [lastSaid.get(id)!] : []))
        )
    }

    /** Call id → the Call row; times come from the test, as the app's clock gives them. */
    const callRows = new Map<string, Call>()
    let callsMade = 0
    const callRecord = (call: Call): CallRecord => ({
        ...call,
        caller: shownPerson(people.get(call.callerId)!),
        callee: shownPerson(people.get(call.calleeId)!)
    })
    /** The open calls of any of `userIds`, oldest first, as copies: a plan changes rows only when applied. */
    const openCallsOf = (userIds: string[]) =>
        [...callRows.values()]
            .filter((call) => isOpenCall(call) && (userIds.includes(call.callerId) || userIds.includes(call.calleeId)))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((call) => callRecord({ ...call }))
    /** Call id → its CallParticipant rows. */
    const callPresence = new Map<string, CallPresence[]>()
    const calls: CallRepositoryPort & { change: jest.Mock; recordMedia: jest.Mock } = {
        find: jest.fn(async (callId: string) => (callRows.has(callId) ? callRecord(callRows.get(callId)!) : null)),
        openOf: jest.fn(async (userId: string) => openCallsOf([userId])),
        change: jest.fn(async (userIds: string[], decide: (open: Call[]) => CallPlan) => {
            const open = openCallsOf(userIds)
            const plan = decide(open)
            const changed: ChangedCall[] = []
            let madeId: string | null = null
            if (plan.create) {
                const { at, ...made } = plan.create
                callsMade += 1
                madeId = `call-${callsMade}`
                const row: Call = {
                    ...made,
                    id: madeId,
                    version: 0,
                    createdAt: at,
                    acceptedAt: null,
                    endedAt: made.status === 'missed' ? at : null
                }
                callRows.set(madeId, row)
                changed.push({ call: callRecord(row), before: null })
            }
            for (const { call, to } of plan.changes) {
                const row = callRows.get(call.id)!
                if (row.version !== call.version) throw new Error(`call ${call.id} changed meanwhile (P2025)`)
                const next: Call = { ...row, ...to, version: row.version + 1 }
                callRows.set(call.id, next)
                changed.push({ call: callRecord(next), before: call.status })
            }
            const answerId = plan.answer === 'new' ? madeId! : plan.answer
            return { changed, answer: callRecord(callRows.get(answerId)!) }
        }),
        ringingSince: jest.fn(async (before: Date) =>
            [...callRows.values()]
                .filter((call) => call.status === 'ringing' && call.createdAt < before)
                .map(({ id, version }) => ({ id, version }))
        ),
        activeCalls: jest.fn(async () =>
            [...callRows.values()].filter((call) => call.status === 'active').map((call) => ({ ...call }))
        ),
        presenceOf: jest.fn(
            async (callIds: string[]) =>
                new Map(callIds.map((callId) => [callId, (callPresence.get(callId) ?? []).map((row) => ({ ...row }))]))
        ),
        recordMedia: jest.fn(
            async (callId: string, decide: (call: Call | null, presence: CallPresence[]) => MediaWrite) => {
                const row = callRows.get(callId)
                const before = (callPresence.get(callId) ?? []).map((one) => ({ ...one }))
                const { write, evict } = decide(row ? { ...row } : null, row ? before : [])
                if (!row) return { call: null, presence: [], written: false, evict }
                if (!write) return { call: callRecord(row), presence: before, written: false, evict }
                const presence = [...before.filter((one) => one.userId !== write.userId), write]
                callPresence.set(callId, presence)
                const next = { ...row, version: row.version + 1 }
                callRows.set(callId, next)
                return { call: callRecord(next), presence, written: true, evict }
            }
        ),
        inActiveCalls: jest.fn(async (userIds: string[]) =>
            [...callRows.values()]
                .filter((call) => call.status === 'active')
                .flatMap((call) => [call.callerId, call.calleeId])
                .filter((userId) => userIds.includes(userId))
        ),
        inSessions: jest.fn(async (sessionIds: string[]) =>
            [...callPresence.entries()].flatMap(([callId, rows]) =>
                callRows.get(callId)?.status === 'active'
                    ? rows
                          .filter((row) => !row.leftAt && row.sessionId && sessionIds.includes(row.sessionId))
                          .map((row) => ({ callId, row: { ...row } }))
                    : []
            )
        )
    }
    /** A call written as if made earlier: ringing from An to Bình unless told. */
    const callAs = (changes: Partial<Call> & Pick<Call, 'callerId' | 'calleeId' | 'dmChannelId'>): Call => {
        callsMade += 1
        const row: Call = {
            id: `call-${callsMade}`,
            video: false,
            status: 'ringing',
            endReason: null,
            version: 0,
            createdAt: new Date('2026-11-24T08:00:00Z'),
            acceptedAt: null,
            endedAt: null,
            ...changes
        }
        callRows.set(row.id, row)
        return row
    }
    const callJobs: CallJobsPort & {
        ringOutAt: jest.Mock
        dropRingOut: jest.Mock
        checkMediaAt: jest.Mock
        dropMediaCheck: jest.Mock
    } = {
        ringOutAt: jest.fn(async () => undefined),
        dropRingOut: jest.fn(async () => undefined),
        checkMediaAt: jest.fn(async () => undefined),
        dropMediaCheck: jest.fn(async () => undefined)
    }
    /** Call id → who LiveKit has in its room; the rooms it has are those listed here. */
    const liveRooms = new Map<string, CallConnection[]>()
    const callMedia: { [K in keyof CallMediaPort]: jest.Mock } = {
        joinToken: jest.fn(async (callId: string, userId: string) => ({
            token: `token-${callId}-${userId}`,
            url: 'ws://livekit.test'
        })),
        participants: jest.fn(async (callId: string) => liveRooms.get(callId) ?? []),
        rooms: jest.fn(async () => [...liveRooms.keys()]),
        removeConnection: jest.fn(async () => true),
        close: jest.fn(async (callId: string) => {
            liveRooms.delete(callId)
        })
    }

    /** Person → the voice room they are in (VoiceState). */
    const inRoom = new Map<string, string>()
    const occupancy = (userId: string, channelId: string): RoomOccupancy => ({
        userId,
        channelId,
        joinedAt: new Date('2026-11-24T07:30:00Z')
    })
    const voiceRooms: VoiceRoomsPort = {
        peopleIn: jest.fn(),
        roomOf: jest.fn(),
        roomsOf: jest.fn(async (userIds: string[]) =>
            userIds.flatMap((userId) => (inRoom.has(userId) ? [occupancy(userId, inRoom.get(userId)!)] : []))
        ),
        peopleInRooms: jest.fn(async (channelIds: string[]) =>
            [...inRoom]
                .filter(([, channelId]) => channelIds.includes(channelId))
                .map(([userId, c]) => occupancy(userId, c))
        )
    }
    const serverChannels = new Map<string, string[]>([
        ['ot', ['hoi-dap', 'phong-hoc', 'phong-voice']],
        ['nd', ['phong-nd']]
    ])
    const studyRooms = new Set(['phong-hoc', 'phong-nd'])
    const channels = {
        channelIdsOf: jest.fn(async (serverId: string) => serverChannels.get(serverId) ?? []),
        studyRoomsAmong: jest.fn(async (channelIds: string[]) => channelIds.filter((id) => studyRooms.has(id)))
    } as unknown as ChannelDirectoryPort
    /** Person → their Solo not ended. */
    const solos = new Map<string, Omit<SoloState, 'userId'>>()
    const soloSessions: SoloSessionsPort = {
        solosOf: jest.fn(async (userIds: string[]) =>
            userIds.flatMap((userId) => (solos.has(userId) ? [{ userId, ...solos.get(userId)! }] : []))
        )
    }
    const activities = new StudyActivities(users, calls, voiceRooms, channels, soloSessions)

    const eventBus = { publish: jest.fn() } as unknown as EventBus & { publish: jest.Mock }
    const published = <T>(type: new (...args: never[]) => T): T[] =>
        eventBus.publish.mock.calls.map(([event]) => event).filter((event): event is T => event instanceof type)

    /** A pair set up as if written earlier. */
    const befriend = (requesterId: string, otherId: string, accepted = true, note: string | null = null) =>
        rows.set(key(requesterId, otherId), {
            requesterId,
            accepted,
            note: accepted ? null : note,
            createdAt: new Date('2026-11-01T00:00:00Z'),
            acceptedAt: accepted ? new Date('2026-11-02T00:00:00Z') : null
        })
    const block = (blockerId: string, blockedId: string) =>
        blocks.set(`${blockerId}|${blockedId}`, new Date('2026-11-03T00:00:00Z'))

    return {
        people,
        rows,
        blocks,
        relationships,
        users,
        limit,
        counter,
        counts,
        presence,
        online,
        membership,
        allowing,
        shared,
        dms,
        dmRows,
        lastMessages,
        say,
        clock,
        calls,
        callRows,
        callAs,
        callJobs,
        callPresence,
        callMedia,
        liveRooms,
        activitySettings,
        inRoom,
        voiceRooms,
        channels,
        studyRooms,
        solos,
        soloSessions,
        activities,
        serversOf,
        eventBus,
        published,
        stateOf,
        befriend,
        block,
        /** What every relationship handler is built with. */
        deps: [relationships, users, limit, eventBus] as const
    }
}
