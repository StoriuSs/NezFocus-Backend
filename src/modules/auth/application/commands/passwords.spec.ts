import {
    CodeInvalidError,
    CurrentPasswordInvalidError,
    PasswordRejectedError,
    RateLimitedError
} from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { ChangePasswordCommand, ForgotPasswordCommand, ResetPasswordCommand } from '..'
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

    it('still signs in after a reset whose email or cache step fails: the password has changed', async () => {
        const w = setup()
        const user = w.account()
        await signIn(w)
        await w.forgot.execute(new ForgotPasswordCommand('ada@example.test', IP))
        const code = w.mailer.lastCode('ada@example.test', 'password-reset')!
        w.mailer.sendPasswordChanged = () => Promise.reject(new Error('queue unreachable'))
        w.cache.invalidateSessions = () => Promise.reject(new Error('redis unreachable'))

        const issued = await w.reset.execute(new ResetPasswordCommand('ada@example.test', code, NEW_PASSWORD, CLIENT))

        expect(issued.accessToken).toBe(`access:${user.id}:session-2`)
        expect(w.sessions.live(user.id)).toEqual(['session-2'])
    })

    it('changes the password knowing the current one: this session stays, every other one ends', async () => {
        const w = setup()
        const user = w.account()
        await signIn(w)
        await signIn(w)
        await signIn(w)

        await w.change.execute(new ChangePasswordCommand(user.id, 'session-2', PASSWORD, NEW_PASSWORD))

        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${NEW_PASSWORD}`)
        expect(w.sessions.live(user.id)).toEqual(['session-2'])
        expect(w.cache.endedSessions.sort()).toEqual(['session-1', 'session-3'])
    })

    it('refuses a new password that breaks a rule, and changes nothing', async () => {
        const w = setup()
        const user = w.account({ username: 'ada_lovelace' })
        await signIn(w)
        await signIn(w)

        // Long and mixed, but it is the username (D-66).
        const change = w.change.execute(new ChangePasswordCommand(user.id, 'session-2', PASSWORD, 'Ada_Lovelace-1'))

        await expect(change).rejects.toThrow(PasswordRejectedError)
        await expect(change).rejects.toMatchObject({ rules: ['matches_username'] })
        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${PASSWORD}`)
        expect(w.sessions.live(user.id)).toEqual(['session-1', 'session-2'])
    })

    it('forgets the wrong current passwords once the change goes through', async () => {
        const w = setup()
        const user = w.account()
        const rule = AUTH_RATE_LIMITS.currentPasswordFailuresPerUser
        for (let i = 0; i < 4; i++) {
            await expect(
                w.change.execute(new ChangePasswordCommand(user.id, 's', 'Wrong-1', NEW_PASSWORD))
            ).rejects.toThrow(CurrentPasswordInvalidError)
        }
        expect(w.limiter.count(rule, user.id)).toBe(4)

        await w.change.execute(new ChangePasswordCommand(user.id, 's', PASSWORD, NEW_PASSWORD))

        expect(w.limiter.count(rule, user.id)).toBe(0)
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

    it('emails that the password changed, in the language of the page it was changed on (D-132)', async () => {
        const w = setup()
        const user = w.account()
        await w.change.execute(new ChangePasswordCommand(user.id, 's', PASSWORD, NEW_PASSWORD, 'vi'))
        expect(w.mailer.notices).toEqual([{ to: 'ada@example.test', kind: 'password-changed', language: 'vi' }])
    })

    it('gives an account with no password its first one by reset, and says one was added', async () => {
        // Made by a code and never completed, or made with Google.
        const w = setup()
        const user = w.googleAccount()
        await w.forgot.execute(new ForgotPasswordCommand('ada@example.test', IP, 'en'))
        expect(w.mailer.codes.at(-1)!.email).toMatchObject({ language: 'en', firstPassword: true })
        const code = w.mailer.lastCode('ada@example.test', 'password-reset')!

        await w.reset.execute(new ResetPasswordCommand('ada@example.test', code, NEW_PASSWORD, CLIENT, 'en'))

        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${NEW_PASSWORD}`)
        expect(w.mailer.notices).toEqual([{ to: 'ada@example.test', kind: 'password-added', language: 'en' }])
    })
})
