/**
 * The presence handlers over an in-memory store with the Redis one's meaning,
 * shared by the presence handlers' spec and the handler of an account waiting
 * to be deleted (each spec next to its handler).
 */
import type { ChosenPresence, UserDirectoryPort } from '@/modules/users'
import { AccountDeletionRequestedEvent } from '@/modules/auth'
import type { MembershipPort } from '@/modules/servers'
import type { Presence } from '@/modules/realtime/domain'
import type { EventPublisherPort, FriendsPort, KeptPresence, PresenceStorePort } from '../../ports'
import {
    ConnectPresenceCommand,
    DisconnectPresenceCommand,
    HeartbeatCommand,
    ReportIdleCommand,
    SweepPresenceCommand
} from './presence.commands'
import {
    ConnectPresenceHandler,
    DisconnectPresenceHandler,
    HeartbeatHandler,
    ReportIdleHandler,
    SweepPresenceHandler
} from './presence.handlers'
import { HideDeletedAccountPresenceHandler } from '../../events/handlers/hide-deleted-account-presence.handler'

/** The Redis store, in memory, with the same meaning. */
export class MemoryPresence implements PresenceStorePort {
    readonly people = new Map<string, KeptPresence>()
    down = false

    private person(userId: string): KeptPresence {
        let kept = this.people.get(userId)
        if (!kept) this.people.set(userId, (kept = { sockets: new Map(), lastSeenAt: 0, shown: 'offline' }))
        return kept
    }
    private reach() {
        if (this.down) throw new Error('Redis is down')
    }
    async touch(userId: string, socketId: string, at: number, idle?: boolean) {
        this.reach()
        const kept = this.person(userId)
        const old = kept.sockets.get(socketId)
        kept.sockets.set(socketId, { idle: idle ?? old?.idle ?? false, seenAt: at })
        kept.lastSeenAt = at
        return old
    }
    /** Who holds each person's lock now; a second taker waits (here: is refused, the test says so). */
    readonly locks = new Set<string>()
    lockedWork = 0
    async lock(userId: string) {
        this.reach()
        if (this.locks.has(userId)) return null
        this.locks.add(userId)
        this.lockedWork++
        return async () => void this.locks.delete(userId)
    }
    async remove(userId: string, socketId: string, at: number) {
        this.reach()
        const kept = this.person(userId)
        kept.sockets.delete(socketId)
        kept.lastSeenAt = at
    }
    async read(userId: string): Promise<KeptPresence> {
        this.reach()
        const kept = this.people.get(userId)
        if (!kept) return { sockets: new Map(), lastSeenAt: 0, shown: 'offline' }
        return { sockets: new Map(kept.sockets), lastSeenAt: kept.lastSeenAt, shown: kept.shown }
    }
    async show(
        userId: string,
        shown: Presence,
        { deadSocketIds, forget }: { deadSocketIds: string[]; forget: boolean }
    ) {
        this.reach()
        if (forget) return void this.people.delete(userId)
        const kept = this.person(userId)
        kept.shown = shown
        for (const id of deadSocketIds) kept.sockets.delete(id)
    }
    async silentSince(before: number) {
        this.reach()
        return [...this.people].filter(([, kept]) => kept.lastSeenAt < before).map(([id]) => id)
    }
}

export const T0 = Date.parse('2026-11-14T10:00:00Z')

export function world(chosen: ChosenPresence = 'online') {
    const store = new MemoryPresence()
    const sent: { to: string; event: string; data: object }[] = []
    const publisher = {
        toUser: (id: string, event: string, data: object) => sent.push({ to: `user:${id}`, event, data }),
        toServer: (id: string, event: string, data: object) => sent.push({ to: `server:${id}`, event, data })
    } as unknown as EventPublisherPort
    const servers = { down: false }
    const membership = {
        serverIdsOf: async () => {
            if (servers.down) throw new Error('Postgres is down')
            return ['s1', 's2']
        }
    } as unknown as MembershipPort
    const choices = new Map<string, ChosenPresence>([['an', chosen]])
    const asked = { times: 0 }
    const directory = {
        presenceOf: async (id: string) => {
            asked.times++
            return choices.get(id) ?? 'online'
        }
    } as unknown as UserDirectoryPort
    const friendList = { down: false, ids: ['binh'] }
    const friends = {
        friendIdsOf: async () => {
            if (friendList.down) throw new Error('Postgres is down')
            return friendList.ids
        }
    } as FriendsPort
    const deps = [store, publisher, membership, directory, friends] as const

    let now = T0
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    return {
        store,
        servers,
        friendList,
        asked,
        sent,
        choices,
        at: (ms: number) => (now = T0 + ms),
        connect: (socket = 'tab-1') =>
            new ConnectPresenceHandler(...deps).execute(new ConnectPresenceCommand('an', socket)),
        disconnect: (socket = 'tab-1') =>
            new DisconnectPresenceHandler(...deps).execute(new DisconnectPresenceCommand('an', socket)),
        heartbeat: (socket = 'tab-1') => new HeartbeatHandler(...deps).execute(new HeartbeatCommand('an', socket)),
        idle: (idle: boolean, socket = 'tab-1') =>
            new ReportIdleHandler(...deps).execute(new ReportIdleCommand('an', socket, idle)),
        sweep: () => new SweepPresenceHandler(...deps).execute(new SweepPresenceCommand(new Date(now))),
        deletionRequested: () =>
            new HideDeletedAccountPresenceHandler(...deps).handle(new AccountDeletionRequestedEvent('an')),
        /** The statuses told about An, in order (one per announcement: the servers' copies are the same). */
        told: () =>
            sent.filter((each) => each.to === 'server:s1').map((each) => (each.data as { status: string }).status)
    }
}
