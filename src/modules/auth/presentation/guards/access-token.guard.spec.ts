import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { DirectoryUser } from '@/modules/users'
import { AllowIncomplete, Public } from '@/shared/presentation/decorators'
import { AuthenticatedUser } from '@/shared/types'
import { AccountIncompleteError } from '@/modules/auth/domain'
import { PrincipalPort, TokenServicePort } from '@/modules/auth/application/ports'
import { AccessTokenGuard } from './access-token.guard'

class Routes {
    @AllowIncomplete()
    completeAccount() {}

    appRoute() {}

    @Public()
    signIn() {}
}

type Request = { headers: { authorization?: string }; user?: AuthenticatedUser }

const contextFor = (route: keyof Routes, request: Request) =>
    ({
        getHandler: () => Routes.prototype[route],
        getClass: () => Routes,
        switchToHttp: () => ({ getRequest: () => request })
    }) as unknown as ExecutionContext

/** A guard whose every token is valid and names an account in this state. */
function guardFor(account: Partial<DirectoryUser>) {
    const tokens = { verifyAccessToken: async () => ({ userId: 'user-1', sessionId: 'session-1' }) }
    const user: DirectoryUser = {
        id: 'user-1',
        email: 'an@example.test',
        roles: ['user'],
        username: null,
        displayName: null,
        avatarUrl: null,
        bio: null,
        completedAt: null,
        deletedAt: null,
        ...account
    }
    const principals = { resolve: async () => ({ user, sessionId: 'session-1' }) }
    return new AccessTokenGuard(
        new Reflector(),
        tokens as unknown as TokenServicePort,
        principals as unknown as PrincipalPort
    )
}

const signedIn = (): Request => ({ headers: { authorization: 'Bearer token' } })

describe('AccessTokenGuard and incomplete accounts (D-61, D-128)', () => {
    it('refuses an incomplete account on every route not marked @AllowIncomplete', async () => {
        const request = signedIn()

        await expect(guardFor({}).canActivate(contextFor('appRoute', request))).rejects.toThrow(AccountIncompleteError)
        expect(request.user).toBeUndefined()
    })

    it('lets an incomplete account through where the "complete your account" page needs it', async () => {
        const request = signedIn()

        await expect(guardFor({}).canActivate(contextFor('completeAccount', request))).resolves.toBe(true)
        expect(request.user).toMatchObject({ id: 'user-1', completed: false })
    })

    it('lets a completed account through everywhere', async () => {
        const request = signedIn()

        await expect(guardFor({ completedAt: new Date() }).canActivate(contextFor('appRoute', request))).resolves.toBe(
            true
        )
        expect(request.user).toMatchObject({ completed: true })
    })

    it('does not look at public routes', async () => {
        await expect(guardFor({}).canActivate(contextFor('signIn', { headers: {} }))).resolves.toBe(true)
    })
})
