import { DELETION_WAIT_MS, deletesAt, dueForDeletion, INCOMPLETE_ACCOUNT_MS } from './account-deletion.rules'

const DAY_MS = 24 * 60 * 60 * 1000

// REQ-AUTH-09, D-141: an account its owner asked to delete is deleted 14 days later.
describe('deletesAt', () => {
    it('is 14 days after the request, to the millisecond', () => {
        expect(deletesAt(new Date('2026-10-15T14:47:00Z'))).toEqual(new Date('2026-10-29T14:47:00Z'))
        expect(DELETION_WAIT_MS).toBe(14 * DAY_MS)
    })
})

// REQ-AUTH-01, D-141: an account left incomplete is deleted 14 days after it was made.
describe('dueForDeletion', () => {
    const now = new Date('2026-11-08T09:00:00Z')

    it('takes the accounts asked to be deleted 14 days ago or earlier', () => {
        expect(dueForDeletion(now).requestedBy).toEqual(new Date(now.getTime() - 14 * DAY_MS))
    })

    it('takes the accounts made 14 days ago or earlier and still incomplete', () => {
        expect(dueForDeletion(now).incompleteSince).toEqual(new Date(now.getTime() - 14 * DAY_MS))
        expect(INCOMPLETE_ACCOUNT_MS).toBe(14 * DAY_MS)
    })
})
