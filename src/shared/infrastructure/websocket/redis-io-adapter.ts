import { INestApplicationContext, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { RedisClientType } from 'redis'
import { Server, ServerOptions } from 'socket.io'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { throttledLog } from '@/shared/utils/log-throttle.util'

/** As long as the first connection of REDIS_CLIENT may take (redis-client.provider.ts). */
const STARTUP_TIMEOUT_MS = 15_000

/**
 * socket.io for the whole app, set up as main.ts and the integration tests
 * run it (configure-app.ts):
 *
 * - The Redis adapter: an event emitted on one instance reaches the sockets
 *   held by every other (ARCHITECTURE 3.2). It needs two connections of its
 *   own, one publishing and one subscribed, copied from REDIS_CLIENT's
 *   settings. Like it, they drop commands while Redis is away rather than
 *   queue them: an event then is lost, and the client catches up over REST
 *   when it reconnects (ARCHITECTURE 3.4).
 * - Websocket only, no long-polling: with several instances, polling needs
 *   sticky sessions at the load balancer; a websocket stays on the instance
 *   it opened on (docs/scaling.md). The web app connects the same way.
 * - CORS from the same setting as the REST API: the web app is on another
 *   origin.
 */
export class RedisIoAdapter extends IoAdapter {
    private readonly logger = new Logger(RedisIoAdapter.name)
    private clients: RedisClientType[] = []
    private adapterConstructor: ReturnType<typeof createAdapter> | undefined

    constructor(private readonly app: INestApplicationContext) {
        super(app)
    }

    /**
     * Opens the two Redis connections, before the app starts. Bounded like
     * REDIS_CLIENT's first connection: a process that exits can be restarted,
     * one that hangs cannot.
     */
    async connectToRedis(): Promise<void> {
        const base = this.app.get<RedisClientType>(REDIS_CLIENT)
        const logError = throttledLog((message) => this.logger.error(message), 60_000)
        const pub = base.duplicate()
        const sub = base.duplicate()
        // Its overloaded publish is not worth typing here: only publish is replaced.
        publishingQuietly(pub as unknown as Publisher, logError)
        for (const client of [pub, sub]) {
            client.on('error', (error: Error) => logError(`Socket Redis client error: ${error.message}`))
        }
        let timer: NodeJS.Timeout | undefined
        try {
            await Promise.race([
                Promise.all([pub.connect(), sub.connect()]),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`Could not reach Redis for sockets within ${STARTUP_TIMEOUT_MS}ms`)),
                        STARTUP_TIMEOUT_MS
                    )
                })
            ])
        } catch (error) {
            await Promise.all([pub, sub].map((client) => client.disconnect().catch(() => undefined)))
            throw error
        } finally {
            clearTimeout(timer)
        }
        this.clients = [pub, sub]
        this.adapterConstructor = createAdapter(pub, sub)
    }

    createIOServer(port: number, options?: ServerOptions): Server {
        const config = this.app.get(ConfigService)
        const server = super.createIOServer(port, {
            ...options,
            transports: ['websocket'],
            cors: {
                origin: config.get<string[]>('cors.origins'),
                credentials: config.get<boolean>('cors.credentials')
            }
        }) as Server
        if (this.adapterConstructor) server.adapter(this.adapterConstructor)
        return server
    }

    async close(server: Server): Promise<void> {
        await super.close(server)
        await Promise.all(this.clients.map((client) => client.quit().catch(() => undefined)))
        this.clients = []
    }
}

/** What publishingQuietly needs of a client. */
export interface Publisher {
    publish(...args: never[]): Promise<unknown>
}

/**
 * The adapter publishes every emit and does not catch a failure: while Redis
 * is away, each would be an unhandled rejection, which ends a Node process.
 * Here a failed publish is logged and dropped instead, like the event it
 * carried (the client catches up over REST).
 */
export function publishingQuietly(client: Publisher, log: (message: string) => void): void {
    const publish = client.publish.bind(client)
    client.publish = (...args: never[]) =>
        publish(...args).catch((error: Error) => {
            log(`Socket event not sent through Redis: ${error.message}`)
            return 0
        })
}
