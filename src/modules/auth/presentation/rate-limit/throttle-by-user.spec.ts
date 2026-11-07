import type { ExecutionContext } from '@nestjs/common'
import { TokenExpiredError, TokenInvalidError } from '@/modules/auth/domain'
import type { TokenServicePort } from '@/modules/auth/application/ports'
import { throttleByUser } from './throttle-by-user'

const LIMITS = { signedIn: 100, anonymous: 300 }

/** Tokens: `good-<user>` is valid, `old` has expired, anything else is forged. */
function tokens() {
    const verified: string[] = []
    const service: Pick<TokenServicePort, 'verifyAccessToken'> = {
        verifyAccessToken: async (token) => {
            verified.push(token)
            if (token.startsWith('good-')) return { userId: token.slice(5), sessionId: 's1' }
            if (token === 'old') throw new TokenExpiredError()
            throw new TokenInvalidError()
        }
    }
    return { service, verified }
}

const request = (authorization?: string, ip = '203.0.113.7') => ({ headers: { authorization }, ip })
const contextOf = (req: object) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext

describe('The global throttler, per user when signed in (D-135)', () => {
    it('counts a request with a valid access token per user, at the signed-in limit', async () => {
        const { service } = tokens()
        const throttle = throttleByUser(service, LIMITS)
        const req = request('Bearer good-ada')

        expect(await throttle.getTracker(req)).toBe('user:ada')
        expect(await throttle.limit(contextOf(req))).toBe(100)
    })

    it('counts the same user from two networks as one, and two users on one network apart', async () => {
        const { service } = tokens()
        const throttle = throttleByUser(service, LIMITS)

        expect(await throttle.getTracker(request('Bearer good-ada', '198.51.100.1'))).toBe('user:ada')
        expect(await throttle.getTracker(request('Bearer good-ada', '203.0.113.7'))).toBe('user:ada')
        expect(await throttle.getTracker(request('Bearer good-bob', '203.0.113.7'))).toBe('user:bob')
    })

    it('counts a request without a token per IP network, at the anonymous limit', async () => {
        const { service } = tokens()
        const throttle = throttleByUser(service, LIMITS)
        const req = request(undefined, '2001:db8:1:2:aaaa::1')

        expect(await throttle.getTracker(req)).toBe('ip:2001:db8:1:2::/64')
        expect(await throttle.limit(contextOf(req))).toBe(300)
    })

    it('counts an expired, forged or malformed token like no token: per IP', async () => {
        const { service } = tokens()
        const throttle = throttleByUser(service, LIMITS)

        for (const header of ['Bearer old', 'Bearer forged', 'Basic good-ada', 'Bearer']) {
            const req = request(header)
            expect(await throttle.getTracker(req)).toBe('ip:203.0.113.7')
            expect(await throttle.limit(contextOf(req))).toBe(300)
        }
    })

    it('checks the token once per request, though the throttler asks twice', async () => {
        const { service, verified } = tokens()
        const throttle = throttleByUser(service, LIMITS)
        const req = request('Bearer good-ada')

        await throttle.limit(contextOf(req))
        await throttle.getTracker(req)

        expect(verified).toEqual(['good-ada'])
    })
})
