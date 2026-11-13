import { publishingQuietly } from './redis-io-adapter'

describe("The socket adapter's publishing connection", () => {
    // @socket.io/redis-adapter does not catch a failed publish: with Redis
    // away (the connection drops commands rather than queue them), every
    // emit would be an unhandled rejection, which ends a Node 22 process.
    it('logs a publish Redis refused and resolves, so no rejection goes unhandled', async () => {
        const logged: string[] = []
        const client = { publish: () => Promise.reject(new Error('The client is closed')) }

        publishingQuietly(client, (message) => logged.push(message))

        await expect(client.publish()).resolves.toBe(0)
        expect(logged).toEqual(['Socket event not sent through Redis: The client is closed'])
    })

    it('passes a publish that worked through unchanged', async () => {
        const client = { publish: () => Promise.resolve(2) }

        publishingQuietly(client, () => undefined)

        await expect(client.publish()).resolves.toBe(2)
    })
})
