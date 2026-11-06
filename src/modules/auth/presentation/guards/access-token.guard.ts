import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '@/shared/presentation/decorators'
import { AuthenticatedUser } from '@/shared/types'
import { TokenMissingError } from '@/modules/auth/domain'
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
        request.user = toAuthenticatedUser(await this.principals.resolve(claims))
        return true
    }
}

function bearerToken(header: string | undefined): string | undefined {
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
        hasSetUsername: user.hasSetUsername
    }
}
