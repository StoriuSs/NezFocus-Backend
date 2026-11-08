import { SessionEndReason } from './errors/session.errors'
import { RevokeReason, SessionEnd } from './ports/session.repository.port'

/** What a session's end is decided from: its row, and its account's. */
export interface SessionState {
    revokedAt: Date | null
    revokedReason: RevokeReason | null
    expiresAt: Date
    account: { deletedAt: Date | null; deletionRequestedAt: Date | null }
}

/**
 * How a session ended. `deletionRequestedAt`: given only when it ended because
 * its owner asked to delete the account, and the account still waits; the
 * device is then told when the account goes (D-141).
 */
export interface SessionEnding {
    ended: SessionEnd
    deletionRequestedAt?: Date
}

/**
 * How a session ended, or null while it is active. The same rules for the
 * database and for the tests' in-memory sessions:
 *
 * - A deleted account wins over any other reason: whatever ended the session,
 *   the account is gone now.
 * - Ended by a request to delete the account that its owner then took back
 *   (restored by signing in elsewhere): nothing is being deleted any more, so
 *   it reads as `revoked`.
 * - A revoked session with no reason stored is a sign-out.
 */
export function sessionEndOf(session: SessionState, now: Date): SessionEnding | null {
    const { deletedAt, deletionRequestedAt } = session.account
    if (deletedAt) return { ended: 'account-deleted' }
    if (session.revokedAt) {
        const reason = session.revokedReason ?? 'logout'
        if (reason !== 'deletion-requested') return { ended: reason }
        return deletionRequestedAt ? { ended: reason, deletionRequestedAt } : { ended: 'revoked' }
    }
    if (session.expiresAt <= now) return { ended: 'expired' }
    return null
}

/** What the device whose session ended is told: SessionEnd, in the words of the API. */
export function sessionEndReason(ended: SessionEnd): SessionEndReason {
    switch (ended) {
        case 'logout':
            return 'signed_out'
        case 'logout-all':
            return 'signed_out_everywhere'
        case 'revoked':
            return 'revoked'
        case 'password-changed':
        case 'password-reset':
            return 'password_changed'
        case 'reuse-detected':
            return 'security'
        case 'deletion-requested':
        case 'account-deleted':
            return 'account_deleted'
        case 'expired':
            return 'expired'
    }
}
