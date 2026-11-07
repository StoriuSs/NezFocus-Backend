import { InvalidCredentialsError, RateLimitedError, RefreshFailedError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { LogoutEverywhereCommand, RefreshCommand } from '..'
import { IP, setup, signIn } from './auth-test-world.shared-spec'

describe('Signing in', () => {
    it('gives a wrong password and an unknown address the same error, and hashes for both', async () => {
        const w = setup()
        w.account()
        await expect(signIn(w, 'ada@example.test', 'Wrong-Password-1')).rejects.toThrow(InvalidCredentialsError)
        await expect(signIn(w, 'nobody@example.test')).rejects.toThrow(InvalidCredentialsError)
        expect(w.hasher.dummyVerifies).toBe(1)
    })

    it('refuses an account with no password yet like a wrong password, after the same hashing work', async () => {
        // Made by a code and never completed: only a code signs in to it (D-60).
        const w = setup()
        w.directory.add()
        await expect(signIn(w)).rejects.toThrow(InvalidCredentialsError)
        expect(w.hasher.dummyVerifies).toBe(1)
        expect(w.sessions.sessions).toHaveLength(0)
    })

    it('refuses the sixth attempt after five failures for an address, even with the right password', async () => {
        const w = setup()
        w.account()
        for (let i = 0; i < 5; i++) await expect(signIn(w, 'ada@example.test', 'Wrong-1')).rejects.toThrow()
        await expect(signIn(w)).rejects.toThrow(RateLimitedError)
    })

    it('limits a burst sent all at once like one sent slowly: five tries for an address, not one per request', async () => {
        const w = setup()
        w.account()
        const results = await Promise.allSettled(
            Array.from({ length: 12 }, () => signIn(w, 'ada@example.test', 'Wrong-1'))
        )
        const reasons = results.map((r) => (r as PromiseRejectedResult).reason)
        expect(reasons.filter((e) => e instanceof InvalidCredentialsError)).toHaveLength(5)
        expect(reasons.filter((e) => e instanceof RateLimitedError)).toHaveLength(7)
        expect(w.limiter.count(AUTH_RATE_LIMITS.loginFailuresPerEmail, 'ada@example.test')).toBe(5)
        await expect(signIn(w)).rejects.toThrow(RateLimitedError)
    })

    it('refuses an IP after thirty failures across any addresses, for five minutes (D-135)', async () => {
        const w = setup()
        w.account()
        for (let i = 0; i < 30; i++) {
            await expect(signIn(w, `n${i}@example.test`)).rejects.toThrow(InvalidCredentialsError)
        }
        const refused = await signIn(w).catch((e: unknown) => e)
        expect(refused).toBeInstanceOf(RateLimitedError)
        expect((refused as RateLimitedError).details).toEqual({ reason: 'network' })
        expect((refused as RateLimitedError).retryAfterSeconds).toBe(5 * 60)
    })

    it('does not count a right password against the IP', async () => {
        const w = setup()
        w.account()
        for (let i = 0; i < 29; i++) await expect(signIn(w, `n${i}@example.test`)).rejects.toThrow()
        for (let i = 0; i < 3; i++) await expect(signIn(w)).resolves.toBeDefined()
        expect(w.limiter.count(AUTH_RATE_LIMITS.loginFailuresPerIp, IP)).toBe(29)
    })
})

describe('Refreshing and ending sessions', () => {
    const signedIn = async () => {
        const w = setup()
        const user = w.account()
        const issued = await signIn(w)
        return { w, user, cookie: issued.refreshToken }
    }

    it('rotates the refresh token, and gives a second tab racing with the old one the same replacement', async () => {
        const { w, user, cookie } = await signedIn()

        const next = await w.refresh.execute(new RefreshCommand(cookie))
        expect(next.refreshToken).not.toBe(cookie)
        expect(next.accessToken).toBe(`access:${user.id}:session-1`)

        // Within the grace window: the same replacement, and the session lives on.
        const second = await w.refresh.execute(new RefreshCommand(cookie))
        expect(second.refreshToken).toBe(next.refreshToken)
        expect(w.sessions.live(user.id)).toEqual(['session-1'])
    })

    it('ends the session when an old cookie comes back after the grace window', async () => {
        const { w, user, cookie } = await signedIn()
        const next = await w.refresh.execute(new RefreshCommand(cookie))

        jest.useFakeTimers({ now: Date.now() + 11_000 })
        try {
            await expect(w.refresh.execute(new RefreshCommand(cookie))).rejects.toThrow(RefreshFailedError)
        } finally {
            jest.useRealTimers()
        }

        expect(w.sessions.live(user.id)).toEqual([])
        expect(w.cache.endedSessions).toEqual(['session-1'])
        // Recorded with whom it concerns, which is what lets it be reported.
        expect(w.events.recorded).toContainEqual({
            event: 'refresh_reuse_detected',
            subject: { userId: user.id, sessionId: 'session-1' }
        })
        // The thief's copy and the owner's current cookie are both dead.
        await expect(w.refresh.execute(new RefreshCommand(next.refreshToken))).rejects.toThrow(RefreshFailedError)
    })

    it('signs out everywhere: every session of the user ends, and no one else’s', async () => {
        const w = setup()
        const ada = w.account()
        const grace = w.account({ email: 'grace@example.test' })
        await signIn(w)
        await signIn(w)
        await signIn(w, 'grace@example.test')

        await w.logoutEverywhere.execute(new LogoutEverywhereCommand(ada.id))

        expect(w.sessions.live(ada.id)).toEqual([])
        expect(w.sessions.live(grace.id)).toHaveLength(1)
        expect(w.cache.endedSessions.sort()).toEqual(['session-1', 'session-2'])
    })
})
