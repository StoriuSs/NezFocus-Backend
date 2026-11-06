import { UsernameTakenError } from '@/modules/users'
import { AccountAlreadyCompleteError, AccountDisabledError, PasswordRejectedError } from '@/modules/auth/domain'
import { AccountCompletionForm, CompleteAccountCommand } from '..'
import { NEW_PASSWORD, PASSWORD, setup, World } from './auth-test-world.shared-spec'

/** An account just made by a code: no password, no username, not completed. */
const newAccount = (w: World) => w.directory.add({ email: 'an.nguyen@example.test' })

const form = (overrides: Partial<AccountCompletionForm> = {}): AccountCompletionForm => ({
    displayName: 'An',
    username: 'an.nguyen',
    password: PASSWORD,
    timezone: 'Asia/Ho_Chi_Minh',
    language: 'vi',
    ...overrides
})

const complete = (w: World, userId: string, overrides: Partial<AccountCompletionForm> = {}) =>
    w.complete.execute(new CompleteAccountCommand(userId, form(overrides)))

describe('Completing an account (REQ-AUTH-01, D-61)', () => {
    it('stores the name, username, password and settings, and drops the cached account', async () => {
        const w = setup()
        const user = newAccount(w)

        await complete(w, user.id, { username: 'An.Nguyen' })

        expect(await w.directory.findById(user.id)).toMatchObject({
            displayName: 'An',
            username: 'an.nguyen',
            completedAt: expect.any(Date)
        })
        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${PASSWORD}`)
        expect(w.directory.settings.get(user.id)).toEqual({ timezone: 'Asia/Ho_Chi_Minh', language: 'vi' })
        // The guard reads the cached account: without this, the same token
        // would still be refused as incomplete.
        expect(w.cache.changedUsers).toEqual([user.id])
        // A first password: nothing to report.
        expect(w.mailer.notices).toEqual([])
    })

    it('tells the owner when it replaces a password chosen through "forgot password" before', async () => {
        const w = setup()
        const user = w.account({ email: 'an.nguyen@example.test' })

        await complete(w, user.id, { password: NEW_PASSWORD })

        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${NEW_PASSWORD}`)
        expect(w.mailer.notices).toEqual([{ to: 'an.nguyen@example.test', kind: 'password-changed', language: 'vi' }])
    })

    it('refuses a password that is the username, the email, or the part before @ (D-66), and stores nothing', async () => {
        const w = setup()
        const user = newAccount(w)

        for (const [password, rule] of [
            ['An.Nguyen', 'matches_username'],
            ['an.nguyen@example.test', 'matches_email'],
            ['An.nguyen9!', 'matches_username']
        ]) {
            const refused = await complete(w, user.id, { password }).catch((error: unknown) => error)
            expect(refused).toBeInstanceOf(PasswordRejectedError)
            expect((refused as PasswordRejectedError).rules).toContain(rule)
        }
        // Judged against the username being chosen, not one the account has.
        const other = newAccount(w)
        await expect(complete(w, other.id, { username: 'harbour', password: 'Harbour-1!' })).rejects.toThrow(
            PasswordRejectedError
        )

        expect(w.credentials.hashes.has(user.id)).toBe(false)
        expect((await w.directory.findById(user.id))!.completedAt).toBeNull()
    })

    it('answers USERNAME_CONFLICT when the username was taken meanwhile; another one then completes it', async () => {
        const w = setup()
        w.account({ email: 'other@example.test', username: 'an.nguyen', completedAt: new Date() })
        const user = newAccount(w)

        const taken = await complete(w, user.id).catch((error: unknown) => error)
        expect(taken).toBeInstanceOf(UsernameTakenError)
        expect((taken as UsernameTakenError).errorKey).toBe('USERNAME_CONFLICT')
        expect((await w.directory.findById(user.id))!.completedAt).toBeNull()

        await complete(w, user.id, { username: 'an.nguyen2', password: NEW_PASSWORD })

        expect((await w.directory.findById(user.id))!.username).toBe('an.nguyen2')
        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${NEW_PASSWORD}`)
    })

    it('refuses a second completion and keeps what the first one chose', async () => {
        const w = setup()
        const user = newAccount(w)
        await complete(w, user.id)

        await expect(complete(w, user.id, { username: 'someone.else', password: NEW_PASSWORD })).rejects.toThrow(
            AccountAlreadyCompleteError
        )

        expect((await w.directory.findById(user.id))!.username).toBe('an.nguyen')
        expect(w.credentials.hashes.get(user.id)).toBe(`hash:${PASSWORD}`)
    })

    it('never leaves a completed account without a password (D-130): no password stored, not completed', async () => {
        const w = setup()
        const user = newAccount(w)
        w.credentials.setHash = async () => {
            throw new Error('database unreachable')
        }

        await expect(complete(w, user.id)).rejects.toThrow('database unreachable')

        expect((await w.directory.findById(user.id))!.completedAt).toBeNull()
    })

    it('refuses a deleted account', async () => {
        const w = setup()
        const user = w.directory.add({ deletedAt: new Date() })

        await expect(complete(w, user.id)).rejects.toThrow(AccountDisabledError)
        expect(w.credentials.hashes.has(user.id)).toBe(false)
    })
})
