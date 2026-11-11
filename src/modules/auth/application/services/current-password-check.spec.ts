import { CurrentPasswordInvalidError, RateLimitedError } from '@/modules/auth/domain'
import { PASSWORD, setup } from '../commands/auth-test-world.shared-spec'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { CurrentPasswordCheck } from './current-password-check'

// The password checked again for another module (handing a server over, D-160).
describe('CurrentPasswordCheck', () => {
    const RULE = AUTH_RATE_LIMITS.currentPasswordFailuresPerUser

    function world() {
        const w = setup()
        const user = w.account({ completedAt: new Date('2026-09-01T00:00:00Z') })
        const check = new CurrentPasswordCheck(w.credentials, w.hasher, w.limiter)
        return { w, user, check }
    }

    it('passes the account password', async () => {
        const { user, check } = world()
        await expect(check.confirm(user.id, PASSWORD)).resolves.toBeUndefined()
    })

    it('refuses a wrong one, counted against the budget changing the password and deleting the account share', async () => {
        const { w, user, check } = world()
        await expect(check.confirm(user.id, 'Wrong-Password-1')).rejects.toThrow(CurrentPasswordInvalidError)
        expect(w.limiter.count(RULE, user.id)).toBe(1)
    })

    it('refuses even the right one once five wrong ones are used up', async () => {
        const { user, check } = world()
        for (let wrong = 0; wrong < RULE.limit; wrong++) {
            await expect(check.confirm(user.id, 'Wrong-Password-1')).rejects.toThrow(CurrentPasswordInvalidError)
        }
        await expect(check.confirm(user.id, PASSWORD)).rejects.toThrow(RateLimitedError)
    })

    it('forgets the wrong ones once the right one is given, as changing the password does', async () => {
        const { w, user, check } = world()
        await expect(check.confirm(user.id, 'Wrong-Password-1')).rejects.toThrow(CurrentPasswordInvalidError)

        await check.confirm(user.id, PASSWORD)

        expect(w.limiter.count(RULE, user.id)).toBe(0)
    })

    it('refuses an account with no password: it has no proof to give', async () => {
        const { w, check } = world()
        const google = w.googleAccount({ completedAt: new Date() })
        await expect(check.confirm(google.id, PASSWORD)).rejects.toThrow(CurrentPasswordInvalidError)
    })
})
