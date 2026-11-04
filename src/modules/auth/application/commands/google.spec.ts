import { InvalidCredentialsError, OAuthSignInError } from '@/modules/auth/domain'
import { FinishOAuthCommand, safeReturnPath, StartOAuthCommand } from '..'
import { CLIENT, sessionOf, setup, signIn, World } from './auth-test-world.shared-spec'

/** Leave for the provider, come back with a code, as the browser would. */
async function viaGoogle(w: World) {
    const started = await w.startOAuth.execute(new StartOAuthCommand('google', '/profile'))
    const query = `code=good-code&state=${started.state}&scope=openid`
    return w.finishOAuth.execute(new FinishOAuthCommand('google', query, started.state, CLIENT))
}

const failure = (promise: Promise<unknown>) =>
    promise.then(
        () => {
            throw new Error('expected the sign-in to fail')
        },
        (error: unknown) => error as OAuthSignInError
    )

describe('Signing in with Google', () => {
    it("refuses a return that is not this browser's: another state, or no cookie", async () => {
        const w = setup()
        const mine = await w.startOAuth.execute(new StartOAuthCommand('google', '/'))
        const theirs = await w.startOAuth.execute(new StartOAuthCommand('google', '/'))

        // Their code and state, in my browser (my cookie): login CSRF.
        const crossed = w.finishOAuth.execute(
            new FinishOAuthCommand('google', `code=good-code&state=${theirs.state}`, mine.state, CLIENT)
        )
        expect((await failure(crossed)).reason).toBe('failed')
        const noCookie = w.finishOAuth.execute(
            new FinishOAuthCommand('google', `code=good-code&state=${mine.state}`, undefined, CLIENT)
        )
        expect((await failure(noCookie)).reason).toBe('failed')
        expect(w.sessions.sessions).toHaveLength(0)
    })

    it('deletes the password of an account never confirmed before linking it', async () => {
        // Someone registered the address first, never confirmed it, and waits
        // for its owner to sign in with Google. The password must not survive.
        const w = setup()
        const squatted = w.account({ emailVerified: false }, 'Squatter-Password-9')

        const finished = await viaGoogle(w)

        expect(sessionOf(finished).accessToken).toBe(`access:${squatted.id}:session-1`)
        expect(finished.notice).toBe('password_removed')
        expect(w.credentials.hashes.has(squatted.id)).toBe(false)
        await expect(signIn(w, 'ada@example.test', 'Squatter-Password-9')).rejects.toThrow(InvalidCredentialsError)
    })

    it('refuses a linked account that has been deleted', async () => {
        // Deleting an account must not be undone by signing in with Google.
        const w = setup()
        const deleted = w.googleAccount({ deletedAt: new Date() })
        w.google.identity = { ...w.google.identity, subject: `google-sub-${deleted.id}` }

        expect((await failure(viaGoogle(w))).reason).toBe('account_deleted')
        expect(w.sessions.sessions).toHaveLength(0)
    })

    it('refuses an address the provider has not verified, and makes nothing', async () => {
        const w = setup()
        w.google.identity = { ...w.google.identity, emailVerified: false }

        expect((await failure(viaGoogle(w))).reason).toBe('email_unverified')
        expect(w.directory.users.size).toBe(0)
        expect(w.sessions.sessions).toHaveLength(0)
    })

    it('returns only to a path of the web app', () => {
        expect(safeReturnPath('/settings?tab=1#x')).toBe('/settings?tab=1#x')
        for (const offSite of ['//evil.example', '/\\evil.example', 'https://evil.example/']) {
            expect(safeReturnPath(offSite)).toBe('/')
        }
    })
})
