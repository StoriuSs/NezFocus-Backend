import type { ExecutionContext } from '@nestjs/common'
import type { TokenServicePort } from '@/modules/auth/application/ports'
import { ipNetwork } from '@/shared/utils/ip-network.util'
import { bearerToken } from '../guards/access-token.guard'

/** Requests a minute, per route: for one signed-in user, and for one anonymous IP network. */
export interface ThrottleLimits {
    signedIn: number
    anonymous: number
}

interface ThrottledRequest {
    headers?: { authorization?: string }
    ip?: string
    socket?: { remoteAddress?: string }
}

interface Subject {
    tracker: string
    signedIn: boolean
}

/**
 * Who the global throttler counts a request against (D-135): the user, when
 * it carries a valid access token; otherwise its IP network (ipNetwork).
 *
 * The throttler runs before the AccessTokenGuard (AppModule), so it checks
 * the token itself: signature and expiry only, no session lookup. A token
 * for a session that has just ended still counts per user for the few
 * minutes it has left, and the guard refuses the request anyway. A forged or
 * expired token is counted like no token, per IP, so making one up does not
 * escape the IP's count.
 *
 * Per user, a lab whose students share one public IP is not one bucket: each
 * signed-in student has their own. Anonymous requests (sign-in, codes) are
 * still counted per IP, with a higher limit since a whole room signs in at
 * once; the auth limits per address hold back guessing at one account.
 *
 * The throttler asks twice per request (the limit, then the tracker); the
 * answer is kept per request, so the token is checked once.
 */
export function throttleByUser(tokens: Pick<TokenServicePort, 'verifyAccessToken'>, limits: ThrottleLimits) {
    const subjects = new WeakMap<object, Promise<Subject>>()

    async function identify(req: ThrottledRequest): Promise<Subject> {
        const token = bearerToken(req.headers?.authorization)
        // Expired or forged: counted as anonymous.
        const userId = token
            ? await tokens.verifyAccessToken(token).then(
                  (claims) => claims.userId,
                  () => null
              )
            : null
        if (userId) return { tracker: `user:${userId}`, signedIn: true }
        return { tracker: `ip:${ipNetwork(req.ip || req.socket?.remoteAddress || 'unknown')}`, signedIn: false }
    }

    function subjectOf(req: ThrottledRequest): Promise<Subject> {
        let subject = subjects.get(req)
        if (!subject) {
            subject = identify(req)
            subjects.set(req, subject)
        }
        return subject
    }

    return {
        limit: async (context: ExecutionContext): Promise<number> =>
            (await subjectOf(context.switchToHttp().getRequest<ThrottledRequest>())).signedIn
                ? limits.signedIn
                : limits.anonymous,
        getTracker: async (req: ThrottledRequest): Promise<string> => (await subjectOf(req)).tracker
    }
}
