import {
    AccountDisabledError,
    CurrentPasswordInvalidError,
    OwnershipTransferRequiredError
} from '@/modules/auth/domain'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { CompleteAccountCommand, DeleteOwnAccountCommand, RestoreAccountCommand } from '..'
import { PASSWORD, setup, signIn, World } from './auth-test-world.shared-spec'

const DAY_MS = 24 * 60 * 60 * 1000

const deleteWith = (w: World, userId: string, password: string) =>
    w.deleteAccount.execute(new DeleteOwnAccountCommand(userId, password, 'vi'))
/** A completed account, as the guard lets only those reach the route. */
const completedAccount = (w: World) => {
    const user = w.account({ completedAt: new Date('2026-09-01T00:00:00Z') })
    w.directory.settings.set(user.id, { timezone: 'Asia/Ho_Chi_Minh', language: 'vi' })
    return user
}

// REQ-AUTH-09, D-141
describe('Asking to delete your own account', () => {
    it('takes the password as proof, and counts wrong ones', async () => {
        const w = setup()
        const user = completedAccount(w)

        await expect(deleteWith(w, user.id, 'Wrong-Password-1')).rejects.toThrow(CurrentPasswordInvalidError)
        expect(user.deletionRequestedAt).toBeNull()
        // Counted: a stolen session must not get unlimited password guesses here.
        expect(w.limiter.count(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, user.id)).toBe(1)
    })

    it('forgets the wrong passwords once the request goes through', async () => {
        const w = setup()
        const user = completedAccount(w)
        await expect(deleteWith(w, user.id, 'Wrong-Password-1')).rejects.toThrow(CurrentPasswordInvalidError)

        await deleteWith(w, user.id, PASSWORD)

        expect(w.limiter.count(AUTH_RATE_LIMITS.currentPasswordFailuresPerUser, user.id)).toBe(0)
    })

    it('refuses an account with no password like a wrong one: there is no other proof', async () => {
        const w = setup()
        const google = w.googleAccount({ completedAt: new Date() })

        await expect(deleteWith(w, google.id, PASSWORD)).rejects.toThrow(CurrentPasswordInvalidError)
        expect(google.deletionRequestedAt).toBeNull()
    })

    it('deletes nothing yet: the account waits 14 days, live, and the answer says until when', async () => {
        const w = setup()
        const user = completedAccount(w)

        const deletesAt = await deleteWith(w, user.id, PASSWORD)

        expect(user.deletedAt).toBeNull()
        expect(user.deletionRequestedAt).toBeInstanceOf(Date)
        expect(deletesAt.getTime() - user.deletionRequestedAt!.getTime()).toBe(14 * DAY_MS)
        // The password stays: signing in again is how it is restored.
        expect(w.credentials.hashes.has(user.id)).toBe(true)
        // Counted as a request; `account_deleted` waits for the sweep.
        expect(w.events.recorded).toEqual(
            expect.arrayContaining([expect.objectContaining({ event: 'account_deletion_requested' })])
        )
        expect(w.events.recorded).not.toContainEqual(expect.objectContaining({ event: 'account_deleted' }))
    })

    it('ends every session, with a reason other devices can explain', async () => {
        const w = setup()
        const user = completedAccount(w)
        await signIn(w)
        await signIn(w)

        await deleteWith(w, user.id, PASSWORD)

        expect(w.sessions.live(user.id)).toEqual([])
        expect(w.sessions.sessions.map((s) => s.revoked)).toEqual(['deletion-requested', 'deletion-requested'])
        expect(w.cache.endedSessions).toHaveLength(2)
        expect(w.cache.changedUsers).toContain(user.id)
    })

    it('emails the date it goes, in the account time zone, and nothing else', async () => {
        const w = setup()
        const user = completedAccount(w)

        const deletesAt = await deleteWith(w, user.id, PASSWORD)

        expect(w.mailer.scheduled).toEqual([
            { to: 'ada@example.test', deletesAt, timeZone: 'Asia/Ho_Chi_Minh', language: 'vi' }
        ])
        expect(w.mailer.notices).toEqual([])
    })

    it('stops an Owner of servers with other members, before anything changes (D-76)', async () => {
        const w = setup()
        const user = completedAccount(w)
        w.servers.blocking = [{ id: 'server-1', name: 'Ôn thi Giải tích 2', memberCount: 13 }]

        const refused = await deleteWith(w, user.id, PASSWORD).catch((e: unknown) => e)

        expect(refused).toBeInstanceOf(OwnershipTransferRequiredError)
        expect((refused as OwnershipTransferRequiredError).details.servers).toEqual(w.servers.blocking)
        expect(user.deletionRequestedAt).toBeNull()
        expect(w.mailer.scheduled).toEqual([])
        expect(w.servers.revokedFor).toEqual([])
    })

    it('stops the invites of the servers they are alone in, once the request is saved, and again once no tab can make one (D-121)', async () => {
        const w = setup()
        const user = completedAccount(w)

        await deleteWith(w, user.id, PASSWORD)

        // The second time after the cached session and user are dropped: a
        // tab still holding them could have made an invite in between.
        expect(w.servers.revoked).toEqual([
            { userId: user.id, cacheCleared: false },
            { userId: user.id, cacheCleared: true }
        ])
    })

    it('looks again once the request is saved: a server someone joined meanwhile takes the request back (L9 review)', async () => {
        const w = setup()
        const user = completedAccount(w)
        const joined = [{ id: 'server-1', name: 'Ghi chú riêng', memberCount: 2 }]
        w.servers.nextChecks = [[], joined]

        const refused = await deleteWith(w, user.id, PASSWORD).catch((e: unknown) => e)

        expect(refused).toBeInstanceOf(OwnershipTransferRequiredError)
        expect((refused as OwnershipTransferRequiredError).details.servers).toEqual(joined)
        expect(user.deletionRequestedAt).toBeNull()
        expect(w.mailer.scheduled).toEqual([])
        expect(w.cache.endedSessions).toEqual([])
    })

    it('stops no invite on a wrong password', async () => {
        const w = setup()
        const user = completedAccount(w)

        await expect(deleteWith(w, user.id, 'Wrong-Password-1')).rejects.toThrow(CurrentPasswordInvalidError)
        expect(w.servers.revokedFor).toEqual([])
    })

    it('refuses an account already waiting or deleted', async () => {
        const w = setup()
        const waiting = completedAccount(w)
        waiting.deletionRequestedAt = new Date()

        await expect(deleteWith(w, waiting.id, PASSWORD)).rejects.toThrow(AccountDisabledError)
        expect(w.mailer.scheduled).toEqual([])
    })
})

describe('Restoring an account waiting to be deleted', () => {
    it('takes the request back, and drops the cached account so the next request passes', async () => {
        const w = setup()
        const user = completedAccount(w)
        await deleteWith(w, user.id, PASSWORD)
        w.cache.changedUsers = []

        await w.restore.execute(new RestoreAccountCommand(user.id))

        expect(user.deletionRequestedAt).toBeNull()
        expect(w.cache.changedUsers).toEqual([user.id])
        expect(w.events.recorded).toContainEqual({ event: 'account_restored' })
    })

    it('answers the same when another tab restored it first', async () => {
        const w = setup()
        const user = completedAccount(w)

        await expect(w.restore.execute(new RestoreAccountCommand(user.id))).resolves.toBeUndefined()
        expect(w.events.recorded).not.toContainEqual({ event: 'account_restored' })
    })

    it('refuses one the sweep deleted first', async () => {
        const w = setup()
        const user = completedAccount(w)
        user.deletedAt = new Date()

        await expect(w.restore.execute(new RestoreAccountCommand(user.id))).rejects.toThrow(AccountDisabledError)
    })
})

// Kiểm 2 review, B10: the sweep deletes an account left incomplete (D-141).
describe('Completing an account the sweep deleted meanwhile', () => {
    it('says the account is gone, not that it is already complete', async () => {
        const w = setup()
        const user = w.account()
        const directory = w.directory
        const complete = directory.complete.bind(directory)
        // Deleted between the handler's read and its write.
        directory.complete = async (id, input) => {
            user.deletedAt = new Date()
            return complete(id, input)
        }

        await expect(
            w.complete.execute(
                new CompleteAccountCommand(user.id, {
                    displayName: 'Ada',
                    username: 'ada',
                    password: 'Harbour-Lantern-42',
                    timezone: 'Asia/Ho_Chi_Minh',
                    language: 'vi'
                })
            )
        ).rejects.toThrow(AccountDisabledError)
    })
})
