import { RedisClientType } from 'redis'
import { SILENCE_MS } from '@/modules/realtime/domain'
import { RedisPresenceStore } from './redis-presence-store.adapter'

const NOW = Date.parse('2026-11-18T10:00:00Z')

/** A Redis whose only hash is Bình's tabs, as presence keeps them. */
const storeWith = (tabs: Record<string, { idle: boolean; seenAt: number }>) =>
    new RedisPresenceStore({
        hGetAll: jest.fn(async (key: string) =>
            key === 'presence:sockets:binh'
                ? Object.fromEntries(Object.entries(tabs).map(([id, tab]) => [id, JSON.stringify(tab)]))
                : {}
        )
    } as unknown as RedisClientType)

describe('RedisPresenceStore.connected (D-187)', () => {
    beforeEach(() => jest.useFakeTimers({ now: NOW }))
    afterEach(() => jest.useRealTimers())

    it('says whether the person has a tab heard from within the silence, whatever they show', async () => {
        expect(await storeWith({ s1: { idle: true, seenAt: NOW - 1000 } }).connected('binh')).toBe(true)
        expect(await storeWith({}).connected('binh')).toBe(false)
    })

    it('does not count a tab gone silent: one left behind by an app instance that stopped', async () => {
        const store = storeWith({ s1: { idle: false, seenAt: NOW - SILENCE_MS - 1 } })
        expect(await store.connected('binh')).toBe(false)
    })

    it('takes the person as not connected when Redis cannot be read, never throwing', async () => {
        const store = new RedisPresenceStore({
            hGetAll: jest.fn().mockRejectedValue(new Error('connection lost'))
        } as unknown as RedisClientType)
        await expect(store.connected('binh')).resolves.toBe(false)
    })
})
