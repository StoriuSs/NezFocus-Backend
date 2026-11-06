import { ConfirmationRequiredError, CurrentPasswordInvalidError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { DeleteOwnAccountCommand } from '..'
import { PASSWORD, setup, World } from './auth-test-world.shared-spec'

const deleteWith = (w: World, userId: string, password?: string) =>
    w.deleteAccount.execute(new DeleteOwnAccountCommand(userId, { password }, 'vi'))
const needs = (error: unknown) => (error as ConfirmationRequiredError).details.needs

describe('Deleting your own account', () => {
    it('takes the password as proof, and counts wrong ones', async () => {
        const w = setup()
        const user = w.account()

        expect(needs(await deleteWith(w, user.id).catch((e: unknown) => e))).toEqual(['password'])
        await expect(deleteWith(w, user.id, 'Wrong-Password-1')).rejects.toThrow(CurrentPasswordInvalidError)
        expect(user.deletedAt).toBeNull()
        // Counted: a stolen session must not get unlimited password guesses here.
        expect(w.limiter.count(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, user.id)).toBe(1)

        await deleteWith(w, user.id, PASSWORD)

        expect(user.deletedAt).toBeInstanceOf(Date)
        expect(w.mailer.notices).toEqual([{ to: 'ada@example.test', kind: 'account-deleted', language: 'vi' }])
    })

    it('asks an account with no password for one: there is no other proof', async () => {
        const w = setup()
        const google = w.googleAccount()

        expect(needs(await deleteWith(w, google.id, PASSWORD).catch((e: unknown) => e))).toEqual(['password'])
        expect(google.deletedAt).toBeNull()
    })
})
