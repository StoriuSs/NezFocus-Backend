import { Secret, TOTP } from 'otpauth'
import { DirectoryUser } from '@/modules/users'
import {
    RateLimitedError,
    TwoFactorChallengeExpiredError,
    TwoFactorCodeInvalidError,
    TwoFactorNotOnError,
    TwoFactorRequiredError
} from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import {
    CompleteTwoFactorSignInCommand,
    ConfirmTwoFactorCommand,
    DisableTwoFactorCommand,
    FinishOAuthCommand,
    ForgotPasswordCommand,
    ResetPasswordCommand,
    SetUpTwoFactorCommand,
    StartOAuthCommand
} from '..'
import { CLIENT, IP, NEW_PASSWORD, setup, signIn, World } from './auth-test-world.shared-spec'

/** What the authenticator app shows now (or at another moment). */
function appCode(w: World, userId: string, at = new Date()) {
    const secret = w.box.open(w.twoFactors.records.get(userId)!.secretSealed).plaintext
    return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
        timestamp: at.getTime()
    })
}

/** A confirmed account with two-step sign-in on: its recovery codes. */
async function withTwoStep(w: World, overrides: Partial<DirectoryUser> = {}) {
    const user = w.account(overrides)
    await w.setUpTwoFactor.execute(new SetUpTwoFactorCommand(user.id))
    const { recoveryCodes } = await w.confirmTwoFactor.execute(
        new ConfirmTwoFactorCommand(user.id, appCode(w, user.id))
    )
    return { user, recoveryCodes }
}

/** The challenge a password sign-in answers with. */
async function challengeFor(w: World) {
    const error = await signIn(w).catch((e: TwoFactorRequiredError) => e)
    expect(error).toBeInstanceOf(TwoFactorRequiredError)
    return (error as TwoFactorRequiredError).details.challenge
}

const complete = (w: World, challenge: string, code: string) =>
    w.completeTwoFactor.execute(new CompleteTwoFactorSignInCommand(challenge, code, CLIENT))

// A code from a step long gone: never right now, and never a format mistake.
const wrongCode = (right: string) => String((Number(right) + 500_000) % 1_000_000).padStart(6, '0')

describe('Two-step sign-in', () => {
    it('asks for the code after the password and signs in with it, once: the challenge and the code are spent', async () => {
        const w = setup()
        const { user } = await withTwoStep(w)
        const challenge = await challengeFor(w)
        expect(w.sessions.live(user.id)).toEqual([]) // no session before the second step

        // A new 30-second step: the confirming code was used.
        const later = new Date(Date.now() + 30_000)
        jest.useFakeTimers({ now: later, doNotFake: ['nextTick', 'setImmediate'] })
        try {
            const code = appCode(w, user.id, later)
            const session = await complete(w, challenge, code)
            expect(session.accessToken).toBe(`access:${user.id}:session-1`)

            await expect(complete(w, challenge, code)).rejects.toThrow(TwoFactorChallengeExpiredError)
            // The same code in a new sign-in: refused too.
            await expect(complete(w, await challengeFor(w), code)).rejects.toThrow(TwoFactorCodeInvalidError)
        } finally {
            jest.useRealTimers()
        }
    })

    it('limits wrong codes per user across challenges: five, then a wait, even for the right code', async () => {
        const w = setup()
        const { user } = await withTwoStep(w)
        const wrong = wrongCode(appCode(w, user.id))
        // Each new challenge has five tries of its own; the user has five in all.
        for (const left of [4, 3, 2, 1]) {
            const error = await complete(w, await challengeFor(w), wrong).catch((e: TwoFactorCodeInvalidError) => e)
            expect((error as TwoFactorCodeInvalidError).details).toEqual({ attemptsLeft: left })
        }
        await expect(complete(w, await challengeFor(w), wrong)).rejects.toThrow(RateLimitedError)
        const refused = await complete(w, await challengeFor(w), appCode(w, user.id)).catch((e: RateLimitedError) => e)
        expect(refused).toBeInstanceOf(RateLimitedError)
        expect((refused as RateLimitedError).details).toEqual({ reason: 'wrong_codes' })
    })

    it('gives a burst of codes sent all at once five tries, not one per request', async () => {
        const w = setup()
        const { user } = await withTwoStep(w)
        const wrong = wrongCode(appCode(w, user.id))
        const challenges = await Promise.all(Array.from({ length: 4 }, () => challengeFor(w)))
        const results = await Promise.allSettled(
            Array.from({ length: 20 }, (_, i) => complete(w, challenges[i % challenges.length], wrong))
        )
        const reasons = results.map((r) => (r as PromiseRejectedResult).reason)
        expect(reasons.filter((e) => e instanceof RateLimitedError).length).toBeGreaterThanOrEqual(15)
        expect(w.limiter.count(AUTH_RATE_LIMITS.twoFactorFailuresPerUser, user.id)).toBe(5)
    })

    it('signs in with a recovery code, once', async () => {
        const w = setup()
        const { user, recoveryCodes } = await withTwoStep(w)

        const typed = recoveryCodes[3].toLowerCase().replace('-', ' ')
        await expect(complete(w, await challengeFor(w), typed)).resolves.toMatchObject({
            accessToken: expect.any(String)
        })
        await expect(complete(w, await challengeFor(w), recoveryCodes[3])).rejects.toThrow(TwoFactorCodeInvalidError)
        expect(await w.twoFactors.countUnusedRecoveryCodes(user.id)).toBe(9)
    })

    it('turns off only with a code from the app or a recovery code', async () => {
        const w = setup()
        const { user, recoveryCodes } = await withTwoStep(w)

        await expect(
            w.disableTwoFactor.execute(new DisableTwoFactorCommand(user.id, wrongCode(appCode(w, user.id))))
        ).rejects.toThrow(TwoFactorCodeInvalidError)
        expect(w.twoFactors.records.get(user.id)!.confirmed).toBe(true)
        // Counted: a stolen session must not get unlimited guesses at the code that turns it off.
        expect(w.limiter.count(AUTH_RATE_LIMITS.twoFactorFailuresPerUser, user.id)).toBe(1)

        await w.disableTwoFactor.execute(new DisableTwoFactorCommand(user.id, recoveryCodes[0]))
        expect(w.twoFactors.records.has(user.id)).toBe(false)
        await expect(signIn(w)).resolves.toMatchObject({ accessToken: expect.any(String) })
        await expect(w.disableTwoFactor.execute(new DisableTwoFactorCommand(user.id, '123456'))).rejects.toThrow(
            TwoFactorNotOnError
        )
    })

    it('stops a password reset and a Google sign-in at the second step too', async () => {
        const w = setup()
        const { user } = await withTwoStep(w)

        await w.forgot.execute(new ForgotPasswordCommand('ada@example.test', IP))
        const code = w.mailer.lastCode('ada@example.test', 'password-reset')!
        await expect(
            w.reset.execute(new ResetPasswordCommand('ada@example.test', code, NEW_PASSWORD, CLIENT))
        ).rejects.toThrow(TwoFactorRequiredError)

        const started = await w.startOAuth.execute(new StartOAuthCommand('google', '/'))
        const finished = await w.finishOAuth.execute(
            new FinishOAuthCommand('google', `code=good-code&state=${started.state}`, started.state, CLIENT)
        )
        expect(finished).toEqual({ challenge: expect.any(String), redirect: '/' })
        expect(w.sessions.live(user.id)).toEqual([])
    })
})
