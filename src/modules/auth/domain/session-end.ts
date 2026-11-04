import { SessionEndReason } from './errors/session.errors'
import { SessionEnd } from './ports/session.repository.port'

/** What the device whose session ended is told: SessionEnd, in the words of the API. */
export function sessionEndReason(ended: SessionEnd): SessionEndReason {
    switch (ended) {
        case 'logout':
            return 'signed_out'
        case 'logout-all':
            return 'signed_out_everywhere'
        case 'password-changed':
        case 'password-reset':
            return 'password_changed'
        case 'reuse-detected':
            return 'security'
        case 'account-deleted':
            return 'account_deleted'
        case 'expired':
            return 'expired'
    }
}
