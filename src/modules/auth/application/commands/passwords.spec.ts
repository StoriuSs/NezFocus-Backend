import { CodeInvalidError, CurrentPasswordInvalidError, RateLimitedError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import {
    ChangePasswordCommand,
    ForgotPasswordCommand,
    ResetPasswordCommand,
    SendPasswordSetCodeCommand,
    SetPasswordCommand
} from '..'
import { CLIENT, IP, NEW_PASSWORD, otherCode, PASSWORD, setup, signIn } from './auth-test-world.shared-spec'

describe('Passwords', () => {
    it('resets the password with the emailed code: every earlier session ends, and the reset signs in', async () => {
        const w = setup()
        const user = w.account()
        await signIn(w)
        await signIn(w)
        await w.forgot.execute(new ForgotPasswordCommand('ada@example.test', IP))
        const code = w.mailer.lastCode('ada@example.test', 'password-reset')!
        // A wrong code counts against the IP, across addresses.
        await expect(
            w.reset.execute(new ResetPasswordCommand('ada@example.test', otherCode(code), NEW_PASSWORD, CLIENT))
        ).rejects.toThrow(CodeInvalidError)
        expect(w.limiter.count(AUTH_RATE_LIMITS.codeAttemptsPerIp, IP)).toBe(1)

        const issued = await w.reset.execute(new ResetPasswordCommand('ada@example.test', code, NEW_PASSWORD, CLIENT))

        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${NEW_PASSWORD}`)
        expect(w.cache.endedSessions.sort()).toEqual(['session-1', 'session-2'])
        // Only the session the reset itself started is left.
        expect(w.sessions.live(user.id)).toEqual(['session-3'])
        expect(issued.accessToken).toBe(`access:${user.id}:session-3`)
    })

    it('refuses a change after five wrong current passwords, even with the right one', async () => {
        const w = setup()
        const user = w.account()
        for (let i = 0; i < 5; i++) {
            await expect(
                w.change.execute(new ChangePasswordCommand(user.id, 's', 'Wrong-1', NEW_PASSWORD))
            ).rejects.toThrow(CurrentPasswordInvalidError)
        }
        await expect(w.change.execute(new ChangePasswordCommand(user.id, 's', PASSWORD, NEW_PASSWORD))).rejects.toThrow(
            RateLimitedError
        )
        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${PASSWORD}`)
    })

    // A sabotage check showed this is the only guard on guessing the code
    // that sets a first password: keep it.
    it('setting a first password counts a wrong code against the IP, and gives a right one its place back', async () => {
        const w = setup()
        const user = w.googleAccount()
        await w.sendPasswordSetCode.execute(new SendPasswordSetCodeCommand(user.id))
        const code = w.mailer.lastCode('ada@example.test', 'password-set')!
        const setPassword = (guess: string) =>
            w.setPassword.execute(new SetPasswordCommand(user.id, guess, NEW_PASSWORD, IP))

        await expect(setPassword(otherCode(code))).rejects.toThrow(CodeInvalidError)
        expect(w.limiter.count(AUTH_RATE_LIMITS.codeAttemptsPerIp, IP)).toBe(1)
        await setPassword(code)
        expect(w.limiter.count(AUTH_RATE_LIMITS.codeAttemptsPerIp, IP)).toBe(1)
        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${NEW_PASSWORD}`)
    })
})
