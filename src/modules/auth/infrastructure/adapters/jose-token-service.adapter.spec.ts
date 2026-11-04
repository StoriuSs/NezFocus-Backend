import { TokenExpiredError, TokenInvalidError } from '@/modules/auth/domain'
import { AuthSettings } from '@/modules/auth/application/auth-settings'
import { JoseTokenService, TokenKeys } from './jose-token-service.adapter'

const settings = { accessTokenTtlSeconds: 900 } as AuthSettings
const keys: TokenKeys = { secret: 'unit-only-secret-0123456789abcdef0123', issuer: 'api', audience: 'web' }

describe('JoseTokenService', () => {
    it('refuses an access token for another audience, from another issuer, or past its lifetime', async () => {
        const tokens = new JoseTokenService(keys, settings)
        const claims = { userId: 'user-1', sessionId: 'session-1' }
        const signedBy = (other: Partial<TokenKeys>) =>
            new JoseTokenService({ ...keys, ...other }, settings).issueAccessToken(claims)

        // The same secret signs them all: only the claims tell them apart.
        await expect(tokens.verifyAccessToken((await tokens.issueAccessToken(claims)).token)).resolves.toEqual(claims)
        await expect(tokens.verifyAccessToken((await signedBy({ audience: 'mobile' })).token)).rejects.toThrow(
            TokenInvalidError
        )
        await expect(tokens.verifyAccessToken((await signedBy({ issuer: 'elsewhere' })).token)).rejects.toThrow(
            TokenInvalidError
        )

        const { token } = await tokens.issueAccessToken(claims)
        jest.useFakeTimers({ now: Date.now() + 901_000 })
        try {
            await expect(tokens.verifyAccessToken(token)).rejects.toThrow(TokenExpiredError)
        } finally {
            jest.useRealTimers()
        }
    })
})
