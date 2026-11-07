import { CodeExpiredError, CodeInvalidError, PasswordRejectedError, RateLimitedError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { ForgotPasswordCommand, ResetPasswordCommand, SendEmailCodeCommand, VerifyEmailCodeCommand } from '..'
import { CLIENT, IP, NEW_PASSWORD, otherCode, setup, World } from './auth-test-world.shared-spec'

const ADA = 'ada@example.test'

const send = (w: World, email = ADA, language: 'vi' | 'en' = 'vi', ip = IP) =>
    w.sendCode.execute(new SendEmailCodeCommand(email, language, ip))

const verify = (w: World, code: string, email = ADA) =>
    w.verifyCode.execute(new VerifyEmailCodeCommand(email, code, CLIENT))

/** What a refusal was: the error's class name, or 'ok'. */
const outcome = (promise: Promise<unknown>) =>
    promise.then(
        () => 'ok',
        (error: unknown) => (error as Error).constructor.name
    )

/** The next minute: one code email a minute per address. */
const nextMinute = (w: World, email = ADA) => w.limiter.reset(AUTH_RATE_LIMITS.codeEmailsPerEmailMinute, email)

describe('Codes by email (REQ-AUTH-01, REQ-AUTH-02)', () => {
    it('answers an address with an account and one without the same, and emails both a code in the page language', async () => {
        const w = setup()
        w.account({ email: 'owner@example.test' })

        await expect(send(w, 'new@example.test', 'vi')).resolves.toBeUndefined()
        await expect(send(w, 'Owner@Example.test ', 'en')).resolves.toBeUndefined()

        // Only the inbox learns which: the email itself says "sign in" or "create an account".
        expect(w.mailer.codes.map(({ to, email }) => [to, email.language, email.accountExists])).toEqual([
            ['new@example.test', 'vi', false],
            ['owner@example.test', 'en', true]
        ])
    })

    it('makes the account on the right code, signed in and not completed yet', async () => {
        const w = setup()
        await send(w)

        const signedIn = await verify(w, w.mailer.lastCode(ADA, 'sign-in')!)

        const user = (await w.directory.findByEmail(ADA))!
        expect(user.completedAt).toBeNull()
        expect(signedIn.account).toEqual({ created: true, completed: false })
        expect(signedIn.session.accessToken).toBe(`access:${user.id}:session-1`)
        expect(w.events.recorded.map((e) => e.event)).toEqual(['registration', 'login_succeeded'])
    })

    it('signs in to the account the address already has, and makes none', async () => {
        const w = setup()
        const owner = w.account({ completedAt: new Date('2026-11-01T00:00:00Z') })
        await send(w)

        const signedIn = await verify(w, w.mailer.lastCode(ADA, 'sign-in')!)

        expect(signedIn.account).toEqual({ created: false, completed: true })
        expect(signedIn.session.accessToken).toBe(`access:${owner.id}:session-1`)
        expect(w.directory.users.size).toBe(1)
    })

    it('takes only the newest code, and each code once', async () => {
        const w = setup()
        await send(w)
        const first = w.mailer.lastCode(ADA, 'sign-in')!
        await nextMinute(w)
        await send(w)
        const second = w.mailer.lastCode(ADA, 'sign-in')!

        if (first !== second) await expect(verify(w, first)).rejects.toThrow(CodeInvalidError)
        await verify(w, second)
        await expect(verify(w, second)).rejects.toThrow(CodeInvalidError)
    })

    it('kills the code on the fifth wrong guess, and refuses the right one after', async () => {
        const w = setup()
        await send(w)
        const code = w.mailer.lastCode(ADA, 'sign-in')!

        for (let i = 0; i < 4; i++) await expect(verify(w, otherCode(code))).rejects.toThrow(CodeInvalidError)
        await expect(verify(w, otherCode(code))).rejects.toThrow(CodeExpiredError)
        await expect(verify(w, code)).rejects.toThrow(CodeExpiredError)
        expect(w.directory.users.size).toBe(0)
    })

    it('refuses a code ten minutes after it was sent', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-06T09:00:00Z') })
        try {
            const w = setup()
            await send(w)
            const code = w.mailer.lastCode(ADA, 'sign-in')!

            jest.setSystemTime(new Date('2026-11-06T09:10:00Z'))

            await expect(verify(w, code)).rejects.toThrow(CodeExpiredError)
        } finally {
            jest.useRealTimers()
        }
    })

    it('sends one code email a minute and five an hour per address, shared with reset codes and counted for every address', async () => {
        for (const hasAccount of [true, false]) {
            const w = setup()
            if (hasAccount) w.account()

            const answers: string[] = []
            answers.push(await outcome(send(w)))
            // Within the minute: refused, and not counted against the hour.
            answers.push(await outcome(w.forgot.execute(new ForgotPasswordCommand(ADA, IP, 'vi'))))
            for (let i = 0; i < 4; i++) {
                await nextMinute(w)
                answers.push(
                    await outcome(i % 2 ? send(w) : w.forgot.execute(new ForgotPasswordCommand(ADA, IP, 'vi')))
                )
            }
            await nextMinute(w)
            answers.push(await outcome(send(w)))

            expect(answers).toEqual(['ok', 'RateLimitedError', 'ok', 'ok', 'ok', 'ok', 'RateLimitedError'])
        }
    })

    it('stops guesses at ten wrong codes an hour per address, across codes, for an address with no account too (D-134)', async () => {
        for (const hasAccount of [true, false]) {
            const w = setup()
            if (hasAccount) w.account()
            const wrongGuesses: string[] = []

            // Two codes, five wrong guesses each: both die.
            for (let round = 0; round < 2; round++) {
                await nextMinute(w)
                await send(w)
                const code = w.mailer.lastCode(ADA, 'sign-in')!
                for (let i = 0; i < 5; i++) wrongGuesses.push(await outcome(verify(w, otherCode(code))))
            }
            // A third code, but the address has had its ten wrong guesses this hour.
            await nextMinute(w)
            await send(w)
            const refused = await verify(w, w.mailer.lastCode(ADA, 'sign-in')!).catch((e: unknown) => e)

            expect(wrongGuesses.filter((answer) => answer === 'CodeInvalidError')).toHaveLength(8)
            expect(refused).toBeInstanceOf(RateLimitedError)
            expect((refused as RateLimitedError).details).toEqual({ reason: 'codes' })
            expect(w.directory.users.size).toBe(hasAccount ? 1 : 0)
        }
    })

    it('sends thirty code emails from one IP in five minutes, to any addresses, reset codes included (D-135)', async () => {
        const w = setup()
        for (let i = 0; i < 30; i++) {
            const address = `n${i}@example.test`
            await (i % 2 ? send(w, address) : w.forgot.execute(new ForgotPasswordCommand(address, IP, 'vi')))
        }
        const refused = await send(w, 'n30@example.test').catch((e: unknown) => e)

        expect(refused).toBeInstanceOf(RateLimitedError)
        expect((refused as RateLimitedError).details).toEqual({ reason: 'network' })
        expect((refused as RateLimitedError).retryAfterSeconds).toBe(5 * 60)
    })

    it('stops wrong codes from one IP at thirty in five minutes, across addresses; a right code is not counted (D-135)', async () => {
        const w = setup()
        // Ten addresses, three wrong guesses each: under every limit of an address.
        for (let i = 0; i < 10; i++) {
            const address = `n${i}@example.test`
            await send(w, address)
            const code = w.mailer.lastCode(address, 'sign-in')!
            for (let guess = 0; guess < 3; guess++) {
                if (i === 9 && guess === 2) break
                await expect(verify(w, otherCode(code), address)).rejects.toThrow(CodeInvalidError)
            }
            // The right code on the last address, after 29 wrong ones: it signs in.
            if (i === 9) await expect(verify(w, code, address)).resolves.toBeDefined()
        }
        expect(w.limiter.count(AUTH_RATE_LIMITS.codeAttemptsPerIp, IP)).toBe(29)

        await send(w, 'late@example.test')
        const late = w.mailer.lastCode('late@example.test', 'sign-in')!
        await expect(verify(w, otherCode(late), 'late@example.test')).rejects.toThrow(CodeInvalidError)
        const refused = await verify(w, late, 'late@example.test').catch((e: unknown) => e)

        expect(refused).toBeInstanceOf(RateLimitedError)
        expect((refused as RateLimitedError).details).toEqual({ reason: 'network' })
        expect((refused as RateLimitedError).retryAfterSeconds).toBe(5 * 60)
    })

    it('does not take a sign-in code for a password reset, nor a reset code for a sign-in', async () => {
        const w = setup()
        w.account()
        await send(w)
        const signInCode = w.mailer.lastCode(ADA, 'sign-in')!
        await nextMinute(w)
        await w.forgot.execute(new ForgotPasswordCommand(ADA, IP, 'vi'))
        const resetCode = w.mailer.lastCode(ADA, 'password-reset')!

        if (signInCode !== resetCode) {
            await expect(
                w.reset.execute(new ResetPasswordCommand(ADA, signInCode, NEW_PASSWORD, CLIENT, 'vi'))
            ).rejects.toThrow(CodeInvalidError)
            await expect(verify(w, resetCode)).rejects.toThrow(CodeInvalidError)
        }
        await expect(verify(w, signInCode)).resolves.toBeDefined()
    })
})

describe('Reset codes for an address with no account (D-121)', () => {
    const reset = (w: World, code: string, password = NEW_PASSWORD, email = ADA) =>
        w.reset.execute(new ResetPasswordCommand(email, code, password, CLIENT, 'vi'))

    it('emails nothing, but wears out after five wrong guesses exactly like a real one', async () => {
        const answers: Record<string, string[]> = {}
        for (const hasAccount of [true, false]) {
            const w = setup()
            if (hasAccount) w.account()
            await w.forgot.execute(new ForgotPasswordCommand(ADA, IP, 'vi'))
            const guesses: string[] = []
            for (let i = 0; i < 6; i++) guesses.push(await outcome(reset(w, '000000')))
            answers[String(hasAccount)] = guesses
            if (!hasAccount) expect(w.mailer.codes).toEqual([])
        }

        expect(answers.false).toEqual(answers.true)
        expect(answers.false.slice(4)).toEqual(['CodeExpiredError', 'CodeExpiredError'])
    })

    it('says a wrong code before saying the password is the username, so the username check finds no accounts', async () => {
        const w = setup()
        w.account({ username: 'harbour_seven' })
        await w.forgot.execute(new ForgotPasswordCommand(ADA, IP, 'vi'))
        const code = w.mailer.lastCode(ADA, 'password-reset')!

        // A stranger's guess with the username as the password: only "wrong code".
        await expect(reset(w, otherCode(code), 'Harbour_Seven1')).rejects.toThrow(CodeInvalidError)
        // The owner, with the right code, is told about the password, and keeps the code.
        await expect(reset(w, code, 'Harbour_Seven1')).rejects.toThrow(PasswordRejectedError)
        await expect(reset(w, code)).resolves.toBeDefined()
    })
})
