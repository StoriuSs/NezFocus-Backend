import { OAuthSignInError } from '@/modules/auth/domain'
import { FinishOAuthCommand, safeReturnPath, StartOAuthCommand } from '..'
import { CLIENT, PASSWORD, sessionOf, setup, World } from './auth-test-world.shared-spec'

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

    it('makes a new address an account not completed yet, with no password (D-130)', async () => {
        const w = setup()

        const finished = await viaGoogle(w)

        const user = (await w.directory.findByEmail('ada@example.test'))!
        expect(sessionOf(finished).accessToken).toBe(`access:${user.id}:session-1`)
        expect(user).toMatchObject({ displayName: 'Ada', completedAt: null })
        expect(w.credentials.hashes.has(user.id)).toBe(false)
        expect(w.mailer.notices).toEqual([])
    })

    it('links the account an address already has, keeps its password, and tells its owner', async () => {
        const w = setup()
        const owner = w.account()

        const finished = await viaGoogle(w)

        expect(sessionOf(finished).accessToken).toBe(`access:${owner.id}:session-1`)
        expect(w.credentials.hashes.get(owner.id)).toBe(`hash:${PASSWORD}`)
        expect(w.mailer.notices).toEqual([{ to: 'ada@example.test', kind: 'sign-in-method-added', language: 'en' }])
    })

    it('still signs in when the email about the new link cannot be queued: the link is made, and a retry would send none (Kiểm 3 review)', async () => {
        const w = setup()
        const owner = w.account()
        w.mailer.sendSignInMethodAdded = () => Promise.reject(new Error('queue unreachable'))

        const finished = await viaGoogle(w)

        expect(sessionOf(finished).accessToken).toBe(`access:${owner.id}:session-1`)
        expect(await w.oauthAccounts.providersOf(owner.id)).toEqual(['google'])
    })

    it('refuses a return to another provider than the one the attempt left for', async () => {
        const w = setup()
        const started = await w.startOAuth.execute(new StartOAuthCommand('google', '/'))
        // An attempt begun with another provider, its state brought back to Google's callback.
        w.oauthState.attempts.get(started.state)!.provider = 'github'

        const crossed = w.finishOAuth.execute(
            new FinishOAuthCommand('google', `code=good-code&state=${started.state}`, started.state, CLIENT)
        )

        expect((await failure(crossed)).reason).toBe('failed')
        expect(w.sessions.sessions).toHaveLength(0)
    })

    it('tells the owner in the language the account chose, as nobody asked from a page (D-132)', async () => {
        const w = setup()
        const owner = w.account({ completedAt: new Date() })
        w.directory.settings.set(owner.id, { timezone: 'Asia/Ho_Chi_Minh', language: 'vi' })

        await viaGoogle(w)

        expect(w.mailer.notices).toEqual([{ to: 'ada@example.test', kind: 'sign-in-method-added', language: 'vi' }])
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
        // Control characters: a newline would split the Location header.
        for (const control of ['/a\r\nSet-Cookie: x=1', '/a\tb', '/a\u007fb']) {
            expect(safeReturnPath(control)).toBe('/')
        }
    })
})
