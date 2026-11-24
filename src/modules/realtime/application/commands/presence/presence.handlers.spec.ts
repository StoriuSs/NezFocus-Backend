import { SILENCE_MS } from '@/modules/realtime/domain'
import { world } from './presence-test-world.shared-spec'

afterEach(() => jest.restoreAllMocks())

describe('Connecting (REQ-AUTH-07)', () => {
    it('shows the person online to their own tabs, their servers and their friends (D-242), and answers what they now show', async () => {
        const { connect, sent } = world()

        await expect(connect()).resolves.toBe('online')

        expect(sent).toEqual([
            { to: 'user:an', event: 'presence.updated', data: { userId: 'an', status: 'online' } },
            { to: 'server:s1', event: 'presence.updated', data: { userId: 'an', status: 'online' } },
            { to: 'server:s2', event: 'presence.updated', data: { userId: 'an', status: 'online' } },
            { to: 'user:binh', event: 'presence.updated', data: { userId: 'an', status: 'online' } }
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

    it('keeps someone the sweep could not tell their friends about, so the next sweep tells it (D-242)', async () => {
        const { connect, disconnect, sweep, at, told, friendList, store, sent } = world()
        await connect()
        await disconnect()
        at(SILENCE_MS + 1)

        friendList.down = true
        await sweep()
        expect(store.people.has('an')).toBe(true)

        friendList.down = false
        await sweep()
        expect(told()).toEqual(['online', 'offline'])
        expect(sent.filter((each) => each.to === 'user:binh').map((each) => each.data)).toEqual([
            { userId: 'an', status: 'online' },
            { userId: 'an', status: 'offline' }
        ])
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
