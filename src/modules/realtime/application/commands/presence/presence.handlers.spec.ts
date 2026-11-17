import type { ChosenPresence, UserDirectoryPort } from '@/modules/users'
import { AccountDeletionRequestedEvent } from '@/modules/auth'
import type { MembershipPort } from '@/modules/servers'
import { SILENCE_MS, type Presence } from '@/modules/realtime/domain'
import type { EventPublisherPort, KeptPresence, PresenceStorePort } from '../../ports'
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
class MemoryPresence implements PresenceStorePort {
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

const T0 = Date.parse('2026-11-14T10:00:00Z')

function world(chosen: ChosenPresence = 'online') {
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
    const deps = [store, publisher, membership, directory] as const

    let now = T0
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    return {
        store,
        servers,
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

afterEach(() => jest.restoreAllMocks())

describe('Connecting (REQ-AUTH-07)', () => {
    it('shows the person online to their servers and to their own tabs, and answers what they now show', async () => {
        const { connect, sent } = world()

        await expect(connect()).resolves.toBe('online')

        expect(sent).toEqual([
            { to: 'user:an', event: 'presence.updated', data: { userId: 'an', status: 'online' } },
            { to: 'server:s1', event: 'presence.updated', data: { userId: 'an', status: 'online' } },
            { to: 'server:s2', event: 'presence.updated', data: { userId: 'an', status: 'online' } }
        ])
    })

    it('tells nothing for a second tab: nothing changed', async () => {
        const { connect, told } = world()
        await connect('tab-1')
        await connect('tab-2')
        expect(told()).toEqual(['online'])
    })

    it('shows an invisible person as offline: nothing is told', async () => {
        const { connect, sent } = world('invisible')
        await expect(connect()).resolves.toBe('offline')
        expect(sent).toEqual([])
    })

    it('keeps an invisible person’s tabs: choosing online later shows them at once', async () => {
        const { connect, choices, told } = world('invisible')
        await connect()
        choices.set('an', 'online')

        await connect('tab-2')

        expect(told()).toEqual(['online'])
    })

    it('still lets the socket in while presence cannot be kept, as online', async () => {
        const { connect, store } = world()
        store.down = true
        await expect(connect()).resolves.toBe('online')
    })
})

describe('Tabs gone unused (REQ-AUTH-07)', () => {
    it('make the person away only once every tab says so, and online again with one in use', async () => {
        const { connect, idle, told } = world()
        await connect('tab-1')
        await connect('tab-2')

        await idle(true, 'tab-1')
        expect(told()).toEqual(['online'])
        await idle(true, 'tab-2')
        expect(told()).toEqual(['online', 'idle'])
        await idle(false, 'tab-1')
        expect(told()).toEqual(['online', 'idle', 'online'])
    })

    it('leave do not disturb as it is', async () => {
        const { connect, idle, told } = world('dnd')
        await connect()
        await idle(true)
        expect(told()).toEqual(['dnd'])
    })
})

describe('Every tab closed (REQ-AUTH-07, D-174)', () => {
    it('keeps the person online for 60 seconds: a page reload does not flash offline', async () => {
        const { connect, disconnect, sweep, at, told } = world()
        await connect()
        await disconnect()

        at(SILENCE_MS)
        await sweep()
        await connect('tab-2')

        expect(told()).toEqual(['online'])
    })

    it('makes the person offline at the first sweep after 60 seconds, and forgets them', async () => {
        const { connect, disconnect, sweep, at, told, store } = world()
        await connect()
        await disconnect()

        at(SILENCE_MS + 1)
        await sweep()

        expect(told()).toEqual(['online', 'offline'])
        expect(store.people.has('an')).toBe(false)
    })

    it('counts a tab whose app instance went without saying as closed: no heartbeat for 60 seconds', async () => {
        const { connect, sweep, at, told } = world()
        await connect()

        at(SILENCE_MS + 1)
        await sweep()

        expect(told()).toEqual(['online', 'offline'])
    })

    it('keeps a person whose tab still beats', async () => {
        const { connect, heartbeat, sweep, at, told } = world()
        await connect()
        at(30_000)
        await heartbeat()
        at(SILENCE_MS + 1)
        await sweep()
        expect(told()).toEqual(['online'])
    })
})

describe('An account waiting to be deleted (D-182)', () => {
    it('shows offline at once, not after the 60 seconds a closed tab is held for, and is forgotten', async () => {
        const { connect, disconnect, deletionRequested, at, told, store } = world()
        await connect()
        await disconnect()

        at(1000)
        await deletionRequested()

        expect(told()).toEqual(['online', 'offline'])
        expect(store.people.has('an')).toBe(false)
    })

    it('stays offline when its tabs close only after: their sockets are cut a moment later', async () => {
        const { connect, disconnect, deletionRequested, sweep, at, told } = world()
        await connect()
        await deletionRequested()
        await disconnect()

        at(1000)
        await sweep()

        expect(told()).toEqual(['online', 'offline'])
    })

    it('tells nothing of someone offline already', async () => {
        const { deletionRequested, told } = world()
        await deletionRequested()
        expect(told()).toEqual([])
    })
})

describe('A tab whose app instance went without saying, beside one still beating (D-174)', () => {
    it('is dropped at the next heartbeat of the live one: the person turns away when the live tab is unused', async () => {
        const { connect, idle, heartbeat, at, told, store } = world()
        await connect('dead')
        await connect('live')
        await idle(true, 'live')

        at(SILENCE_MS + 1)
        await heartbeat('live')

        expect(told()).toEqual(['online', 'idle'])
        expect([...(await store.read('an')).sockets.keys()]).toEqual(['live'])
    })
})

describe('Every change to a person', () => {
    it('is made under their lock, one at a time, and the lock let go after', async () => {
        const { connect, idle, heartbeat, disconnect, store } = world()
        await connect()
        await idle(true)
        await heartbeat()
        await disconnect()
        expect(store.lockedWork).toBe(4)
        expect(store.locks.size).toBe(0)
    })

    it('works nothing out when a tab says again what it said: unused twice', async () => {
        const { connect, idle, sent, asked } = world()
        await connect('tab-1')
        await connect('tab-2')
        await idle(true, 'tab-1')
        const [told, read] = [sent.length, asked.times]
        await idle(true, 'tab-1')
        expect([sent.length, asked.times]).toEqual([told, read])
    })

    it('keeps someone the sweep could not tell about, so the next sweep tells it (their servers unreadable)', async () => {
        const { connect, disconnect, sweep, at, told, servers, store } = world()
        await connect()
        await disconnect()
        at(SILENCE_MS + 1)

        servers.down = true
        await sweep()
        expect(store.people.has('an')).toBe(true)

        servers.down = false
        await sweep()
        expect(told()).toEqual(['online', 'offline'])
    })
})

describe('A heartbeat', () => {
    it('brings back a tab the sweep had dropped, and shows the person again', async () => {
        const { connect, heartbeat, sweep, at, told } = world()
        await connect()
        at(SILENCE_MS + 1)
        await sweep()

        await heartbeat()

        expect(told()).toEqual(['online', 'offline', 'online'])
    })

    it('is dropped quietly while presence cannot be kept', async () => {
        const { heartbeat, store } = world()
        store.down = true
        await expect(heartbeat()).resolves.toBeUndefined()
    })
})
