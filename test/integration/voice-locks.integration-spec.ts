import { randomUUID } from 'crypto'
import { NestExpressApplication } from '@nestjs/platform-express'
import { VOICE_STATE_REPOSITORY, VoiceStateRepositoryPort } from '@/modules/voice/domain'
import { bootApp, closeApp } from './helpers'

/**
 * The voice locks against a small connection pool (M4 A2b, backend-review
 * 14.2): a media turn and a room's list hold a connection for their advisory
 * lock while the work inside asks for another. More of them at once than the
 * pool has connections must queue, not take every connection and wait on
 * each other until the pool's timeout (a role given to many people in rooms
 * at once fans out one turn each).
 *
 * Its own file: the pool's size is read when the app's modules load, once
 * per file. Requires Postgres and Redis: `pnpm test:services:up`.
 */
describe('Voice locks with a small pool (integration)', () => {
    const POOL = 3
    let app: NestExpressApplication
    let states: VoiceStateRepositoryPort
    const before = process.env.DB_POOL_MAX

    beforeAll(async () => {
        process.env.DB_POOL_MAX = String(POOL)
        app = await bootApp()
        states = app.get<VoiceStateRepositoryPort>(VOICE_STATE_REPOSITORY)
    })

    afterAll(async () => {
        await closeApp(app)
        if (before === undefined) delete process.env.DB_POOL_MAX
        else process.env.DB_POOL_MAX = before
    })

    /** Some work that reads the database, as a recheck reads the row and the permissions. */
    const reads = (userId: string) => async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return states.find(userId)
    }

    it('runs twice as many media turns at once as the pool has connections, each reading inside', async () => {
        const people = Array.from({ length: POOL * 2 }, () => randomUUID())
        const started = Date.now()
        const done = await Promise.allSettled(people.map((userId) => states.inMediaTurn(userId, reads(userId))))
        expect(done.map((one) => one.status)).toEqual(people.map(() => 'fulfilled'))
        // Queued, not stuck until the pool gives up (10 seconds).
        expect(Date.now() - started).toBeLessThan(5_000)
    }, 30_000)

    it("tells rooms' lists and runs media turns at once, more than the pool has connections", async () => {
        const rooms = Array.from({ length: POOL }, () => randomUUID())
        const people = Array.from({ length: POOL }, () => randomUUID())
        const started = Date.now()
        const done = await Promise.allSettled([
            ...rooms.map((channelId) =>
                states.tellOccupants(channelId, async () => {
                    await reads(channelId)()
                })
            ),
            ...people.map((userId) => states.inMediaTurn(userId, reads(userId)))
        ])
        expect(done.map((one) => one.status)).toEqual([...rooms, ...people].map(() => 'fulfilled'))
        expect(Date.now() - started).toBeLessThan(5_000)
    }, 30_000)
})
