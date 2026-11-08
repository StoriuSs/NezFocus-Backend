import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ALLOW_INCOMPLETE_KEY, ALLOW_PENDING_DELETION_KEY, IS_PUBLIC_KEY } from '@/shared/presentation/decorators'
import { AuthenticatedUser } from '@/shared/types'
import { AccountIncompleteError, AccountPendingDeletionError, TokenMissingError } from '@/modules/auth/domain'
import { deletesAt } from '@/modules/users'
import { PRINCIPAL, Principal, PrincipalPort, TOKEN_SERVICE, TokenServicePort } from '@/modules/auth/application/ports'

/**
 * The global authentication guard: every route needs a signed-in user unless
 * it is marked `@Public()`.
 *
 * For each request: read the bearer token, verify its signature and expiry
 * here (no call to anything), then check that the session it names is still
 * live and the account still exists. That last step is what makes a sign-out,
 * a password change or an account deletion take effect on the very next
 * request rather than when the access token expires. It costs one Redis round
 * trip, falling back to Postgres.
 *
 * The account read there also says whether it is completed (D-61): until it
 * is, only routes marked `@AllowIncomplete()` answer, and the rest say
 * ACCOUNT_INCOMPLETE. Read from the account, not from a claim in the token
 * (D-128, as changed in L7): the read happens anyway, and nothing has to keep
 * a claim right at each of the places tokens are issued.
 *
 * The same read says whether its owner asked to delete it (D-141): signed in
 * again within the 14 days, only routes marked `@AllowPendingDeletion()`
 * answer until it is restored, and the rest say ACCOUNT_PENDING_DELETION.
 *
 * Registered after the throttler in AppModule, so anonymous traffic is rate
 * limited before it reaches this.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
        @Inject(PRINCIPAL) private readonly principals: PrincipalPort
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass()
        ])
        if (isPublic) return true

        const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: unknown }>()
        const token = bearerToken(request.headers.authorization)
        if (!token) throw new TokenMissingError()

        const claims = await this.tokens.verifyAccessToken(token)
        const user = toAuthenticatedUser(await this.principals.resolve(claims))
        if (user.deletesAt && !this.marked(context, ALLOW_PENDING_DELETION_KEY)) {
            throw new AccountPendingDeletionError(user.deletesAt)
        }
        if (!user.completed && !this.marked(context, ALLOW_INCOMPLETE_KEY)) throw new AccountIncompleteError()
        request.user = user
        return true
    }

    private marked(context: ExecutionContext, key: string): boolean {
        return this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]) === true
    }
}

/** The token of an `Authorization: Bearer <token>` header; also read by the throttler (throttle-by-user.ts). */
export function bearerToken(header: string | undefined): string | undefined {
    const [scheme, token] = header?.split(' ') ?? []
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined
}

function toAuthenticatedUser({ user, sessionId }: Principal): AuthenticatedUser {
    return {
        id: user.id,
        sessionId,
        email: user.email,
        roles: user.roles,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        completed: user.completedAt !== null,
        deletesAt: user.deletionRequestedAt ? deletesAt(user.deletionRequestedAt) : null
    }
}
