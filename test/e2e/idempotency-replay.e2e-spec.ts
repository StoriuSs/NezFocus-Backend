import { Test } from '@nestjs/testing'
import { Body, Controller, HttpCode, INestApplication, Post, Req } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { randomUUID } from 'crypto'
import { TransformInterceptor } from '@/shared/presentation/interceptors/transform.interceptor'
import { IdempotencyInterceptor } from '@/shared/presentation/interceptors/idempotency.interceptor'
import { Idempotent } from '@/shared/presentation/decorators/idempotent.decorator'
import { IdempotencyService } from '@/shared/infrastructure/idempotency/idempotency.service'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'

/**
 * The commands IdempotencyService sends, answered from a Map as Redis would:
 * the real service builds the keys, so how it scopes them is what is tested.
 */
class InMemoryRedis {
    readonly store = new Map<string, string>()
    async get(key: string) {
        return this.store.get(key) ?? null
    }
    async set(key: string, value: string, options: { NX?: boolean } = {}) {
        if (options.NX && this.store.has(key)) return null
        this.store.set(key, value)
        return 'OK'
    }
    /** RELEASE_IF_OWNER and RENEW_IF_OWNER: act only while the key holds the claim. */
    async eval(script: string, { keys, arguments: args }: { keys: string[]; arguments: string[] }) {
        if (this.store.get(keys[0]) !== args[0]) return 0
        if (script.includes("'DEL'")) this.store.delete(keys[0])
        return 1
    }
}

let executions = 0

@Controller('things')
class ThingsController {
    @Post()
    @HttpCode(200)
    @Idempotent('1h')
    create(@Body() body: unknown, @Req() req: { user?: { id: string } }) {
        executions++
        return { owner: req.user?.id, received: body }
    }
}

describe('Idempotency (e2e)', () => {
    let app: INestApplication

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ThingsController],
            providers: [
                IdempotencyService,
                { provide: REDIS_CLIENT, useValue: new InMemoryRedis() },
                { provide: ConfigService, useValue: { get: () => 30_000 } },
                // Same order as AppModule: Transform > Idempotency.
                { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
                { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }
            ]
        }).compile()

        app = moduleRef.createNestApplication()
        // Who is signed in, as the auth guard would set it.
        app.use((req: { user?: { id: string }; headers: Record<string, string> }, _res: unknown, next: () => void) => {
            if (req.headers['x-user']) req.user = { id: req.headers['x-user'] }
            next()
        })
        await app.init()
    })

    beforeEach(() => {
        executions = 0
    })

    afterAll(async () => {
        await app.close()
    })

    const post = (user: string, key: string, body: object) =>
        request(app.getHttpServer()).post('/things').set('x-user', user).set('Idempotency-Key', key).send(body)

    it("never hands one user another's response for the same key", async () => {
        const key = randomUUID()
        const mine = await post('alice', key, { note: 'private' }).expect(200)
        const theirs = await post('mallory', key, { note: 'private' }).expect(200)

        expect(mine.body.data).toEqual({ owner: 'alice', received: { note: 'private' } })
        expect(theirs.body.data).toEqual({ owner: 'mallory', received: { note: 'private' } })
        expect(executions).toBe(2)

        // The same user with the same key gets the first response replayed.
        expect((await post('alice', key, { note: 'private' }).expect(200)).body.data.owner).toBe('alice')
        expect(executions).toBe(2)
    })

    it('refuses the same key with a different body, instead of replaying the first response', async () => {
        const key = randomUUID()
        await post('alice', key, { amount: 1 }).expect(200)

        const res = await post('alice', key, { amount: 999 }).expect(422)

        expect(res.body.meta?.type ?? res.body.type).toBe('IDEMPOTENCY_KEY_MISMATCH')
        expect(executions).toBe(1)
    })
})
