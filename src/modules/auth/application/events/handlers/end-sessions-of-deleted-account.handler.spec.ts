import { AccountDeletedEvent } from '@/modules/users'
import { CredentialRepositoryPort, OAuthAccountRepositoryPort, SessionRepositoryPort } from '@/modules/auth/domain'
import { AuthEvent, AuthEventsPort, SessionCachePort } from '../../ports'
import { EndSessionsOfDeletedAccountHandler } from './end-sessions-of-deleted-account.handler'

/** The handler with ports that do nothing but answer, and the metrics it records. */
function setup() {
    const recorded: AuthEvent[] = []
    const events: AuthEventsPort = { record: (event) => void recorded.push(event) }
    const sessions = { revokeAllForUser: async () => [] } as unknown as SessionRepositoryPort
    const credentials = { delete: async () => undefined } as unknown as CredentialRepositoryPort
    const links = { deleteForUser: async () => undefined } as unknown as OAuthAccountRepositoryPort
    const cache = { invalidateUser: async () => undefined, invalidateSessions: async () => undefined }
    const handler = new EndSessionsOfDeletedAccountHandler(
        sessions,
        credentials,
        links,
        cache as unknown as SessionCachePort,
        events
    )
    return { handler, recorded }
}

describe('After the sweep deletes an account', () => {
    it('counts a deletion its owner asked for, not a sign-up left incomplete (Kiểm 3 review)', async () => {
        const { handler, recorded } = setup()

        await handler.handle(new AccountDeletedEvent('asked', true))
        await handler.handle(new AccountDeletedEvent('abandoned', false))

        expect(recorded).toEqual(['account_deleted'])
    })
})
