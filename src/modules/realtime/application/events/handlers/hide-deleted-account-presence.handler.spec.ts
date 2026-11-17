import { world } from '../../commands/presence/presence-test-world.shared-spec'

afterEach(() => jest.restoreAllMocks())

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
