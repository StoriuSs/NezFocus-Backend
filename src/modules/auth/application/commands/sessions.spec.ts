import { InvalidCredentialsError, RateLimitedError, RefreshFailedError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import {
    ListSessionsQuery,
    LoginCommand,
    LogoutCommand,
    RefreshCommand,
    RevokeOtherSessionsCommand,
    RevokeSessionCommand
} from '..'
import { IP, PASSWORD, setup, signIn, World } from './auth-test-world.shared-spec'

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

    it('opens no session when the password changed while it was being checked (a reset racing it)', async () => {
        const w = setup()
        const user = w.account()
        const verify = w.hasher.verify.bind(w.hasher)
        w.hasher.verify = async (hash, password) => {
            // The owner resets the password, ending every session, while this old one is hashed.
            w.credentials.hashes.set(user.id, 'hash:Quartz-Meadow-Otter-9')
            return verify(hash, password)
        }

        await expect(signIn(w)).rejects.toThrow(InvalidCredentialsError)
        expect(w.sessions.sessions).toHaveLength(0)
    })

    it('does not put the old password back when re-hashing races a reset', async () => {
        const w = setup()
        const user = w.account()
        w.hasher.needsRehash = () => true
        const verify = w.hasher.verify.bind(w.hasher)
        w.hasher.verify = async (hash, password) => {
            w.credentials.hashes.set(user.id, 'hash:Quartz-Meadow-Otter-9')
            return verify(hash, password)
        }

        await expect(signIn(w)).rejects.toThrow(InvalidCredentialsError)
        expect(w.credentials.hashes.get(user.id)).toBe('hash:Quartz-Meadow-Otter-9')
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
})

describe('The list of sessions, and ending them from it (D-75, D-138)', () => {
    const CHROME_WINDOWS = {
        ip: '14.231.162.5',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    }
    const SAFARI_IPHONE = {
        ip: '113.190.42.9',
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
    }
    const FIREFOX_UBUNTU = {
        ip: '203.162.5.6',
        userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0'
    }

    const at = (iso: string) => jest.setSystemTime(new Date(iso))
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-01T08:00:00Z') }))
    afterEach(() => jest.useRealTimers())

    const signInFrom = (w: World, client: { ip: string; userAgent: string }, email = 'ada@example.test') =>
        w.login.execute(new LoginCommand(email, PASSWORD, client))
    const list = (w: World, userId: string, currentSessionId: string) =>
        w.listSessions.execute(new ListSessionsQuery(userId, currentSessionId))
    const endedWith = (w: World, cookie: string) =>
        w.refresh.execute(new RefreshCommand(cookie)).then(
            () => 'still live',
            (e: RefreshFailedError) => e.details?.reason
        )

    it('lists live sessions only, this device first and then by latest use, each named and its IP masked', async () => {
        const w = setup()
        const ada = w.account()
        w.account({ email: 'grace@example.test' })
        const phone = await signInFrom(w, SAFARI_IPHONE) // session-1
        at('2026-11-03T09:00:00Z')
        await signInFrom(w, FIREFOX_UBUNTU) // session-2
        at('2026-11-05T09:00:00Z')
        await signInFrom(w, FIREFOX_UBUNTU) // session-3, signed out below
        await signInFrom(w, CHROME_WINDOWS, 'grace@example.test') // session-4, someone else's
        at('2026-11-06T22:15:00Z')
        await w.refresh.execute(new RefreshCommand(phone.refreshToken, SAFARI_IPHONE))
        await w.revokeSession.execute(new RevokeSessionCommand(ada.id, 'session-3'))
        at('2026-11-07T09:00:00Z')
        await signInFrom(w, CHROME_WINDOWS) // session-5, this device

        const sessions = await list(w, ada.id, 'session-5')

        expect(sessions).toEqual([
            {
                id: 'session-5',
                browser: 'Chrome',
                os: 'Windows',
                device: 'desktop',
                ip: '14.231.x.x',
                lastActiveAt: new Date('2026-11-07T09:00:00Z'),
                signedInAt: new Date('2026-11-07T09:00:00Z'),
                current: true
            },
            {
                id: 'session-1',
                browser: 'Safari',
                os: 'iOS',
                device: 'mobile',
                ip: '113.190.x.x',
                lastActiveAt: new Date('2026-11-06T22:15:00Z'),
                signedInAt: new Date('2026-11-01T08:00:00Z'),
                current: false
            },
            {
                id: 'session-2',
                browser: 'Firefox',
                os: 'Ubuntu',
                device: 'desktop',
                ip: '203.162.x.x',
                lastActiveAt: new Date('2026-11-03T09:00:00Z'),
                signedInAt: new Date('2026-11-03T09:00:00Z'),
                current: false
            }
        ])
    })

    it('puts this device first even when another was used later, and a tie in use goes to the later sign-in', async () => {
        const w = setup()
        const ada = w.account()
        await signInFrom(w, CHROME_WINDOWS) // session-1, this device
        at('2026-11-02T08:00:00Z')
        const older = await signInFrom(w, FIREFOX_UBUNTU) // session-2
        at('2026-11-03T08:00:00Z')
        const newer = await signInFrom(w, SAFARI_IPHONE) // session-3
        at('2026-11-04T08:00:00Z')
        await w.refresh.execute(new RefreshCommand(older.refreshToken, FIREFOX_UBUNTU))
        await w.refresh.execute(new RefreshCommand(newer.refreshToken, SAFARI_IPHONE))

        const sessions = await list(w, ada.id, 'session-1')

        expect(sessions.map((s) => s.id)).toEqual(['session-1', 'session-3', 'session-2'])
    })

    it('shows where and in what a session was last used: each refresh records its IP and browser', async () => {
        const w = setup()
        const ada = w.account()
        const laptop = await signInFrom(w, CHROME_WINDOWS)
        at('2026-11-02T19:30:00Z')
        // The same laptop at school, on Edge this time.
        await w.refresh.execute(
            new RefreshCommand(laptop.refreshToken, {
                ip: '2405:4802:1d2:a0b0::7',
                userAgent: `${CHROME_WINDOWS.userAgent} Edg/141.0.0.0`
            })
        )

        const [session] = await list(w, ada.id, 'session-1')

        expect(session).toMatchObject({
            browser: 'Edge',
            ip: '2405:4802:x:x…',
            lastActiveAt: new Date('2026-11-02T19:30:00Z'),
            signedInAt: new Date('2026-11-01T08:00:00Z')
        })
    })

    it('ends one session at once, with the plain reason, and leaves the rest', async () => {
        const w = setup()
        const ada = w.account()
        const phone = await signInFrom(w, SAFARI_IPHONE) // session-1
        const laptop = await signInFrom(w, CHROME_WINDOWS) // session-2

        await w.revokeSession.execute(new RevokeSessionCommand(ada.id, 'session-1'))

        expect(w.sessions.live(ada.id)).toEqual(['session-2'])
        // The cached copy goes too: the next request with its access token is refused.
        expect(w.cache.endedSessions).toEqual(['session-1'])
        await expect(endedWith(w, phone.refreshToken)).resolves.toBe('revoked')
        await expect(endedWith(w, laptop.refreshToken)).resolves.toBe('still live')
    })

    it('answers the same for a session that already ended or is someone else’s, and ends nothing of theirs', async () => {
        const w = setup()
        const ada = w.account()
        const grace = w.account({ email: 'grace@example.test' })
        await signIn(w) // session-1
        await signIn(w, 'grace@example.test') // session-2
        await w.revokeSession.execute(new RevokeSessionCommand(ada.id, 'session-1'))

        // Ended a moment ago on its own, or ended twice: no error (10-settings, edge cases).
        await expect(w.revokeSession.execute(new RevokeSessionCommand(ada.id, 'session-1'))).resolves.toBeUndefined()
        await expect(w.revokeSession.execute(new RevokeSessionCommand(ada.id, 'session-2'))).resolves.toBeUndefined()
        await expect(w.revokeSession.execute(new RevokeSessionCommand(ada.id, 'nope'))).resolves.toBeUndefined()

        expect(w.sessions.live(grace.id)).toEqual(['session-2'])
    })

    it('signs out the other devices: this one stays, the others are told which button ended them', async () => {
        const w = setup()
        const ada = w.account()
        const grace = w.account({ email: 'grace@example.test' })
        const phone = await signInFrom(w, SAFARI_IPHONE) // session-1
        await signInFrom(w, FIREFOX_UBUNTU) // session-2
        const laptop = await signInFrom(w, CHROME_WINDOWS) // session-3, this device
        await signIn(w, 'grace@example.test') // session-4

        const ended = await w.revokeOtherSessions.execute(new RevokeOtherSessionsCommand(ada.id, 'session-3'))

        expect(ended).toBe(2)
        expect(w.sessions.live(ada.id)).toEqual(['session-3'])
        expect(w.sessions.live(grace.id)).toEqual(['session-4'])
        expect(w.cache.endedSessions.sort()).toEqual(['session-1', 'session-2'])
        await expect(endedWith(w, phone.refreshToken)).resolves.toBe('signed_out_everywhere')
        await expect(endedWith(w, laptop.refreshToken)).resolves.toBe('still live')
        // Nothing left to end: none, and no error.
        await expect(w.revokeOtherSessions.execute(new RevokeOtherSessionsCommand(ada.id, 'session-3'))).resolves.toBe(
            0
        )
    })
})

describe('Signing out', () => {
    it('ends the session of the cookie: its access token stops now, and other modules hear of it', async () => {
        const w = setup()
        const ada = w.account()
        const phone = await signIn(w) // session-1
        await signIn(w) // session-2

        await w.logout.execute(new LogoutCommand(phone.refreshToken))

        expect(w.sessions.live(ada.id)).toEqual(['session-2'])
        expect(w.cache.endedSessions).toEqual(['session-1'])
        // The realtime module cuts that session's sockets off (SessionsEndedEvent).
        expect(w.sessionsEnded).toEqual([['session-1']])
    })

    it('does nothing without a cookie, or with one whose session already ended', async () => {
        const w = setup()
        w.account()
        const phone = await signIn(w)
        await w.logout.execute(new LogoutCommand(phone.refreshToken))

        await w.logout.execute(new LogoutCommand(undefined))
        await w.logout.execute(new LogoutCommand(phone.refreshToken))

        expect(w.sessionsEnded).toEqual([['session-1']])
    })
})
