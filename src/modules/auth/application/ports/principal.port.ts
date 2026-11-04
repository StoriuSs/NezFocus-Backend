import { DirectoryUser } from '@/modules/users'
import { AccessTokenClaims } from './token-service.port'

/** Who a request is from: the user as they are now, and the session it came in. */
export interface Principal {
    user: DirectoryUser
    sessionId: string
}

/**
 * Principal Port — turns a verified access token into the user behind it,
 * checking on every request that the session is still live.
 *
 * On the hot path of every authenticated request, so implementations cache —
 * and must honour an invalidation at once, which is what makes a sign-out or
 * an account deletion take effect before the access token expires.
 */
export interface PrincipalPort {
    /**
     * @throws SessionRevokedError when the session has ended
     * @throws TokenInvalidError when the token names a session of another user
     * @throws AccountDisabledError when the account has been deleted
     */
    resolve(claims: AccessTokenClaims): Promise<Principal>
}

export const PRINCIPAL = Symbol('PrincipalPort')
