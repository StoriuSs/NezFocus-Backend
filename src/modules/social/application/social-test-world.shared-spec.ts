import { EventBus } from '@nestjs/cqrs'
import type { LastMessage, LastMessagesPort } from '@/modules/messaging'
import { Presence, PresencePort } from '@/modules/realtime'
import { MembershipPort, SharedServer } from '@/modules/servers'
import { DirectoryUser, UserDirectoryPort } from '@/modules/users'
import { isHidden, LimitsUnavailableError, shownPerson } from '@/shared/domain'
import { RateLimitRule } from '@/shared/types/rate-limit.type'
import {
    afterWrite,
    DmEntry,
    DmRepositoryPort,
    PairState,
    RelationshipDecision,
    RelationshipEntry,
    RelationshipRepositoryPort,
    Standing
} from '../domain'
import { SocialLimitPort } from './ports'

/*
 * People for the social handler specs, in memory (spec 09): An, Bình, Chi,
 * Dũng completed; Giang waiting to be deleted; Hà deleted for good; Khoa
 * never completed. An and Bình share the server "ot", Bình and Chi the
 * server "nd". Times in Hồ Chí Minh City for An. Everyone lets server
 * members message them until a test says otherwise (`allowing`). DMs and
 * their last messages as the Prisma repository and messaging keep them,
 * on a clock a test moves (`clock`).
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
            note: standing === 'incoming' ? row.note : null,
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
    const membership = {
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
        eventBus,
        published,
        stateOf,
        befriend,
        block,
        /** What every relationship handler is built with. */
        deps: [relationships, users, limit, eventBus] as const
    }
}
