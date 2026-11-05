import { CodeExpiredError, CodeInvalidError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { RegisterCommand, VerifyEmailCommand } from '..'
import { CLIENT, IP, NEW_PASSWORD, otherCode, PASSWORD, setup, World } from './auth-test-world.shared-spec'

/** A sign-up waiting for its address to be confirmed: the code it was emailed. */
async function registered() {
    const w = setup()
    await w.register.execute(new RegisterCommand('ada@example.test', PASSWORD, IP))
    const user = (await w.directory.findByEmail('ada@example.test'))!
    return { w, user, code: w.mailer.lastCode('ada@example.test', 'email-verify')! }
}

const confirm = (w: World, code: string, password = PASSWORD) =>
    w.verify.execute(new VerifyEmailCommand('ada@example.test', code, password, CLIENT))

describe('Signing up and confirming the address', () => {
    it('answers a new address and one that has an account the same, and emails a code only to the new one', async () => {
        const w = setup()
        const owner = w.account({ email: 'owner@example.test' })
        const hash = jest.spyOn(w.hasher, 'hash')

        await expect(w.register.execute(new RegisterCommand('new@example.test', PASSWORD, IP))).resolves.toBe(undefined)
        await expect(w.register.execute(new RegisterCommand('owner@example.test', NEW_PASSWORD, IP))).resolves.toBe(
            undefined
        )

        // The same work for both, so the same time.
        expect(hash).toHaveBeenCalledTimes(2)
        expect(w.credentials.hashes.get(owner.id)).toBe(`hash:${PASSWORD}`)
        expect(w.mailer.codes.map((c) => c.to)).toEqual(['new@example.test'])
        expect(w.mailer.accountExists).toEqual(['owner@example.test'])
    })

    it('stops a sign-up again by someone else from taking the account over before its owner confirms', async () => {
        const { w, user } = await registered()
        // Someone who knows the address signs it up again with their own password:
        // that replaces the password, and the address gets a new code. (A minute
        // later: one sign-up email a minute per address.)
        await w.limiter.reset(AUTH_RATE_LIMITS.registrationsPerEmailMinute, 'ada@example.test')
        await w.register.execute(new RegisterCommand('ada@example.test', 'Their-Password-77', '203.0.113.9'))
        const code = w.mailer.lastCode('ada@example.test', 'email-verify')!

        // The owner confirms with that code and the password they chose: refused, and nothing confirmed.
        await expect(confirm(w, code)).rejects.toThrow(CodeInvalidError)
        expect(user.emailVerified).toBe(false)
        expect(w.sessions.live(user.id)).toEqual([])

        // Signing up again puts the owner's password back, with a new code.
        await w.limiter.reset(AUTH_RATE_LIMITS.registrationsPerEmailMinute, 'ada@example.test')
        await w.register.execute(new RegisterCommand('ada@example.test', PASSWORD, IP))
        await confirm(w, w.mailer.lastCode('ada@example.test', 'email-verify')!)
        expect(user.emailVerified).toBe(true)
    })

    it("refuses the right code with a password other than the last sign-up's, and leaves the code its tries", async () => {
        const { w, user, code } = await registered()
        // As many tries as the code has, all with the wrong password.
        for (let i = 0; i < 5; i++) {
            await expect(confirm(w, code, 'Wrong-Password-1')).rejects.toThrow(CodeInvalidError)
        }
        expect(user.emailVerified).toBe(false)
        // Counted against the IP like wrong codes.
        expect(w.limiter.count(AUTH_RATE_LIMITS.codeAttemptsPerIp, IP)).toBe(5)
        await confirm(w, code)
        expect(user.emailVerified).toBe(true)
    })

    it('kills the code on the fifth wrong guess, and refuses the right one after', async () => {
        const { w, user, code } = await registered()
        for (let i = 0; i < 4; i++) {
            await expect(confirm(w, otherCode(code))).rejects.toThrow(CodeInvalidError)
        }
        await expect(confirm(w, otherCode(code))).rejects.toThrow(CodeExpiredError)
        await expect(confirm(w, code)).rejects.toThrow(CodeExpiredError)
        expect(user.emailVerified).toBe(false)
    })
})
