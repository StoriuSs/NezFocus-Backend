import { SessionState, sessionEndOf } from './session-end'

const NOW = new Date('2026-11-08T12:00:00Z')
const REQUESTED = new Date('2026-11-01T12:00:00Z')

/** A live session of a live account, unless told otherwise. */
const state = (over: Partial<SessionState> = {}, account: Partial<SessionState['account']> = {}): SessionState => ({
    revokedAt: null,
    revokedReason: null,
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    ...over,
    account: { deletedAt: null, deletionRequestedAt: null, ...account }
})
const revoked = (reason: SessionState['revokedReason']) => ({ revokedAt: NOW, revokedReason: reason })

describe('How a session ended (sessionEndOf)', () => {
    it('is active while not revoked, not expired, and its account is not deleted', () => {
        expect(sessionEndOf(state(), NOW)).toBeNull()
        expect(sessionEndOf(state({ expiresAt: NOW }), NOW)).toEqual({ ended: 'expired' })
    })

    it('reads a revoked session with no reason stored as a sign-out', () => {
        expect(sessionEndOf(state(revoked(null)), NOW)).toEqual({ ended: 'logout' })
        expect(sessionEndOf(state(revoked('password-reset')), NOW)).toEqual({ ended: 'password-reset' })
    })

    it('says the account is deleted, whatever ended the session', () => {
        const gone = { deletedAt: NOW, deletionRequestedAt: null }
        expect(sessionEndOf(state(revoked('logout-all'), gone), NOW)).toEqual({ ended: 'account-deleted' })
        expect(sessionEndOf(state(revoked('deletion-requested'), gone), NOW)).toEqual({ ended: 'account-deleted' })
        expect(sessionEndOf(state({}, gone), NOW)).toEqual({ ended: 'account-deleted' })
    })

    it('gives when the deletion was asked for only while the account still waits (D-141)', () => {
        const waiting = sessionEndOf(state(revoked('deletion-requested'), { deletionRequestedAt: REQUESTED }), NOW)
        expect(waiting).toEqual({ ended: 'deletion-requested', deletionRequestedAt: REQUESTED })
        // Other reasons on a waiting account carry no date.
        expect(sessionEndOf(state(revoked('logout'), { deletionRequestedAt: REQUESTED }), NOW)).toEqual({
            ended: 'logout'
        })
    })

    it('reads a session ended by a deletion its owner took back as revoked: nothing is being deleted', () => {
        expect(sessionEndOf(state(revoked('deletion-requested')), NOW)).toEqual({ ended: 'revoked' })
    })
})
