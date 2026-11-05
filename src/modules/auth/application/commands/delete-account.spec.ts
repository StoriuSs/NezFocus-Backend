import { CodeInvalidError, ConfirmationRequiredError, CurrentPasswordInvalidError } from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { DeleteOwnAccountCommand, SendAccountDeletionCodeCommand } from '..'
import { IP, otherCode, PASSWORD, setup, World } from './auth-test-world.shared-spec'

type Proof = { password?: string; code?: string }
const deleteWith = (w: World, userId: string, proof: Proof) =>
    w.deleteAccount.execute(new DeleteOwnAccountCommand(userId, proof, IP))
const needs = (error: unknown) => (error as ConfirmationRequiredError).details.needs

describe('Deleting your own account', () => {
    it('takes proof: the password, or an emailed code for an account without one', async () => {
        const w = setup()
        const user = w.account()

        expect(needs(await deleteWith(w, user.id, {}).catch((e: unknown) => e))).toEqual(['password'])
        await expect(deleteWith(w, user.id, { password: 'Wrong-Password-1' })).rejects.toThrow(
            CurrentPasswordInvalidError
        )
        expect(user.deletedAt).toBeNull()
        // Counted: a stolen session must not get unlimited password guesses here.
        expect(w.limiter.count(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, user.id)).toBe(1)
        await deleteWith(w, user.id, { password: PASSWORD })
        expect(user.deletedAt).toBeInstanceOf(Date)

        // Made with Google: no password, so a code sent to the address is the proof.
        const google = w.googleAccount({ email: 'google@example.test' })
        expect(needs(await deleteWith(w, google.id, { password: PASSWORD }).catch((e: unknown) => e))).toEqual(['code'])
        await w.sendDeletionCode.execute(new SendAccountDeletionCodeCommand(google.id))
        const code = w.mailer.lastCode('google@example.test', 'account-delete')!
        await expect(deleteWith(w, google.id, { code: otherCode(code) })).rejects.toThrow(CodeInvalidError)
        expect(google.deletedAt).toBeNull()
        expect(w.limiter.count(AUTH_RATE_LIMITS.codeAttemptsPerIp, IP)).toBe(1)
        await deleteWith(w, google.id, { code })
        expect(google.deletedAt).toBeInstanceOf(Date)
    })
})
