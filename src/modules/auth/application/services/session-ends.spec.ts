import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { EventBus } from '@nestjs/cqrs'
import { SessionCachePort } from '../ports'
import { SessionsEndedEvent } from '../events/sessions-ended.event'
import { SessionEnds } from './session-ends'

function setup(options: { cacheFails?: boolean } = {}) {
    const invalidated: string[][] = []
    const published: unknown[] = []
    const cache = {
        invalidateSessions: async (ids: string[]) => {
            invalidated.push(ids)
            if (options.cacheFails) throw new Error('Redis is down')
        }
    } as unknown as SessionCachePort
    const events = { publish: (event: unknown) => void published.push(event) } as unknown as EventBus
    return { ends: new SessionEnds(cache, events), invalidated, published }
}

describe('Telling the app that sessions ended', () => {
    it('stops honouring their access tokens and tells the other modules (the socket of each is cut off)', async () => {
        const { ends, invalidated, published } = setup()

        await ends.ended(['s1', 's2'])

        expect(invalidated).toEqual([['s1', 's2']])
        expect(published).toEqual([new SessionsEndedEvent(['s1', 's2'])])
    })

    // A socket connecting in between reads the session from the cache: once
    // the event is out, it must already see the session as ended.
    it('drops the cached sessions before the other modules hear of it', async () => {
        const order: string[] = []
        const cache = { invalidateSessions: async () => void order.push('cache') } as unknown as SessionCachePort
        const events = { publish: () => void order.push('event') } as unknown as EventBus

        await new SessionEnds(cache, events).ended(['s1'])

        expect(order).toEqual(['cache', 'event'])
    })

    it('does nothing for no session', async () => {
        const { ends, invalidated, published } = setup()

        await ends.ended([])

        expect(invalidated).toEqual([])
        expect(published).toEqual([])
    })

    it('still tells the other modules when the cache cannot be reached, then reports the failure', async () => {
        const { ends, published } = setup({ cacheFails: true })

        await expect(ends.ended(['s1'])).rejects.toThrow('Redis is down')

        expect(published).toEqual([new SessionsEndedEvent(['s1'])])
    })
})

describe('Every place in auth that ends a session', () => {
    // A new way to end a session that called the cache itself would leave that
    // session's sockets open until they drop on their own.
    it('goes through SessionEnds, not SESSION_CACHE.invalidateSessions', () => {
        const root = join(__dirname, '..', '..')
        const files = (dir: string): string[] =>
            readdirSync(dir).flatMap((name) => {
                const path = join(dir, name)
                return statSync(path).isDirectory() ? files(path) : [path]
            })
        const allowed = new Set([
            'application/services/session-ends.ts',
            'application/ports/session-cache.port.ts',
            'infrastructure/adapters/redis-session-cache.adapter.ts'
        ])

        const callers = files(root)
            .filter((path) => path.endsWith('.ts') && !/\.(?:shared-)?spec\.ts$/.test(path))
            .map((path) => relative(root, path).split('\\').join('/'))
            .filter((path) => !allowed.has(path))
            .filter((path) => readFileSync(join(root, path), 'utf8').includes('invalidateSessions('))

        expect(callers).toEqual([])
    })
})
