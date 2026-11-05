import { CommandBus } from '@nestjs/cqrs'
import { DeleteAccountCommand, DirectoryUser, UserDirectoryPort } from '@/modules/users'
import { AuthSettings } from '../auth-settings'
import { OAuthSettings } from '../oauth-settings'
import {
    AuthEvent,
    AuthEventsPort,
    AuthEventSubject,
    AuthMailerPort,
    OAuthAttempt,
    OAuthChecks,
    OAuthIdentity,
    OAuthProviderPort,
    OAuthStatePort,
    PasswordHasherPort,
    SessionCachePort,
    TokenServicePort,
    RateLimitPort
} from '../ports'
import {
    CodeCheck,
    CodePurpose,
    CredentialRepositoryPort,
    OAuthAccountRepositoryPort,
    RevokeReason,
    RotateInput,
    RotationOutcome,
    SessionEnd,
    SessionRecord,
    SessionRepositoryPort,
    VerificationCodeRepositoryPort
} from '@/modules/auth/domain'
import { RateLimitRule, RateLimitState } from '../rate-limits'
import { CodeIssuer } from '../services/code-issuer'
import { SessionIssuer } from '../services/session-issuer'
import { SignInGate } from '../services/sign-in-gate'
import { SignInMethods } from '../services/sign-in-methods'
import {
    ChangePasswordHandler,
    DeleteOwnAccountHandler,
    FinishOAuthHandler,
    ForgotPasswordHandler,
    LoginCommand,
    LoginHandler,
    LogoutEverywhereHandler,
    RefreshHandler,
    RegisterHandler,
    ResetPasswordHandler,
    SendAccountDeletionCodeHandler,
    SendPasswordSetCodeHandler,
    SetPasswordHandler,
    StartOAuthHandler,
    VerifyEmailHandler
} from '..'

/*
 * The world the auth command specs run in: every port of the auth commands
 * as an in-memory stand-in that keeps state (counters, sessions, codes)
 * rather than recording calls, so each test reads as the behaviour it checks:
 * "after five failures the sixth is refused", not "hit was called twice". The
 * Postgres and Redis adapters behind the same ports are covered by
 * test/integration/auth.integration-spec.ts.
 *
 * Named *.shared-spec.ts: tsconfig.build.json leaves it out of the build like
 * any spec, and Jest does not run it as a suite of its own.
 */

export const PASSWORD = 'Harbour-Lantern-42'
export const NEW_PASSWORD = 'Quartz-Meadow-Otter-9'
export const IP = '203.0.113.7'
export const CLIENT = { ip: IP, userAgent: 'jest' }

/** A six-digit code that is not this one. */
export const otherCode = (code: string) => (code === '000000' ? '111111' : '000000')

class FakeDirectory implements UserDirectoryPort {
    users = new Map<string, DirectoryUser>()
    private next = 1

    add(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
        const user: DirectoryUser = {
            id: `user-${this.next++}`,
            email: 'ada@example.test',
            emailVerified: true,
            roles: ['user'],
            username: null,
            displayName: null,
            avatarUrl: null,
            bio: null,
            hasSetUsername: false,
            deletedAt: null,
            ...overrides
        }
        this.users.set(user.id, user)
        return user
    }

    async findByEmail(email: string) {
        return [...this.users.values()].find((u) => u.email === email.toLowerCase() && !u.deletedAt) ?? null
    }
    async findById(id: string) {
        return this.users.get(id) ?? null
    }
    async createUnverified(email: string) {
        if (await this.findByEmail(email)) return null
        return this.add({ email, emailVerified: false })
    }
    async createVerified(email: string, displayName: string | null) {
        if (await this.findByEmail(email)) return null
        return this.add({ email, emailVerified: true, displayName })
    }
    async markEmailVerified(id: string) {
        this.users.get(id)!.emailVerified = true
    }
}

class FakeCredentials implements CredentialRepositoryPort {
    hashes = new Map<string, string>()
    async findHash(userId: string) {
        return this.hashes.get(userId) ?? null
    }
    async setHash(userId: string, hash: string) {
        this.hashes.set(userId, hash)
    }
    async delete(userId: string) {
        this.hashes.delete(userId)
    }
    async deleteForDeletedAccounts() {
        return 0
    }
}

/** Keeps each event, with whom it concerns. */
class FakeEvents implements AuthEventsPort {
    recorded: { event: AuthEvent; subject?: AuthEventSubject }[] = []
    record(event: AuthEvent, subject?: AuthEventSubject) {
        this.recorded.push({ event, subject })
    }
}

/** "Hashes" by prefixing. */
class FakeHasher implements PasswordHasherPort {
    dummyVerifies = 0
    async hash(password: string) {
        return `hash:${password}`
    }
    async verify(hash: string, password: string) {
        return hash === `hash:${password}`
    }
    async verifyDummy() {
        this.dummyVerifies++
    }
    needsRehash() {
        return false
    }
}

/** Same counting as the shared RateLimiter: `hit` is over past the limit, `check` at it. */
class FakeLimiter implements RateLimitPort {
    counts = new Map<string, number>()
    private key = (rule: RateLimitRule, subject: string) => `${rule.name}:${subject.toLowerCase()}`
    count(rule: RateLimitRule, subject: string) {
        return this.counts.get(this.key(rule, subject)) ?? 0
    }
    async hit(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
        const count = this.count(rule, subject) + 1
        this.counts.set(this.key(rule, subject), count)
        return { count, limited: count > rule.limit, retryAfterSeconds: rule.windowMs / 1000 }
    }
    async check(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
        const count = this.count(rule, subject)
        return { count, limited: count >= rule.limit, retryAfterSeconds: rule.windowMs / 1000 }
    }
    async release(rule: RateLimitRule, subject: string) {
        const count = this.count(rule, subject)
        if (count > 0) this.counts.set(this.key(rule, subject), count - 1)
    }
    async reset(rule: RateLimitRule, subject: string) {
        this.counts.delete(this.key(rule, subject))
    }
}

class FakeTokens implements TokenServicePort {
    private next = 1
    async issueAccessToken(claims: { userId: string; sessionId: string }) {
        return { token: `access:${claims.userId}:${claims.sessionId}`, expiresInSeconds: 900 }
    }
    async verifyAccessToken(): Promise<never> {
        throw new Error('not used by the commands')
    }
    newRefreshToken() {
        const token = `refresh-${this.next++}`
        return { token, hash: this.hashRefreshToken(token) }
    }
    hashRefreshToken(token: string) {
        return `sha:${token}`
    }
    hashVerificationCode(code: string, userId: string, purpose: string) {
        return `hmac:${purpose}:${userId}:${code}`
    }
}

interface StoredSession extends SessionRecord {
    tokenHash: string
    usedTokens: Map<string, Date>
    revoked?: RevokeReason
}

/** The rotation rules of PrismaSessionRepository, without the row lock. */
class FakeSessions implements SessionRepositoryPort {
    sessions: StoredSession[] = []
    private next = 1

    async create(input: Parameters<SessionRepositoryPort['create']>[0]) {
        const session: StoredSession = {
            id: `session-${this.next++}`,
            userId: input.userId,
            expiresAt: input.expiresAt,
            tokenHash: input.refreshTokenHash,
            usedTokens: new Map()
        }
        this.sessions.push(session)
        return { id: session.id, userId: session.userId, expiresAt: session.expiresAt }
    }
    async findEnded(id: string, now: Date): Promise<SessionEnd | null> {
        const s = this.sessions.find((x) => x.id === id)
        if (!s) return null
        if (s.revoked) return s.revoked
        return s.expiresAt <= now ? 'expired' : null
    }
    async findActive(id: string, now: Date) {
        const s = this.sessions.find((x) => x.id === id && !x.revoked && x.expiresAt > now)
        return s ? { id: s.id, userId: s.userId, expiresAt: s.expiresAt } : null
    }
    async rotate(input: RotateInput): Promise<RotationOutcome> {
        const current = this.sessions.find((s) => s.tokenHash === input.tokenHash)
        const used = this.sessions.find((s) => s.usedTokens.has(input.tokenHash))
        const session = current ?? used
        if (!session) return { kind: 'invalid' }
        if (session.revoked) return { kind: 'invalid', ended: session.revoked }
        if (session.expiresAt <= input.now) return { kind: 'invalid', ended: 'expired' }
        const record = { id: session.id, userId: session.userId, expiresAt: session.expiresAt }
        if (current) {
            await input.beforeCommit()
            session.usedTokens.set(session.tokenHash, input.now)
            session.tokenHash = input.newTokenHash
            return { kind: 'rotated', session: record }
        }
        const usedAt = session.usedTokens.get(input.tokenHash)!
        if (input.now.getTime() - usedAt.getTime() <= input.graceMs) return { kind: 'grace', session: record }
        session.revoked = 'reuse-detected'
        return { kind: 'reused', session: record }
    }
    async revokeByTokenHash(tokenHash: string, reason: RevokeReason) {
        const s = this.sessions.find((x) => x.tokenHash === tokenHash && !x.revoked)
        if (!s) return null
        s.revoked = reason
        return s.id
    }
    async revokeAllForUser(userId: string, reason: RevokeReason, _now: Date, exceptSessionId?: string) {
        const ended = this.sessions.filter((s) => s.userId === userId && !s.revoked && s.id !== exceptSessionId)
        ended.forEach((s) => (s.revoked = reason))
        return ended.map((s) => s.id)
    }
    async deleteEnded() {
        return 0
    }
    async revokeForDeletedAccounts(): Promise<string[]> {
        return []
    }
    live(userId: string) {
        return this.sessions.filter((s) => s.userId === userId && !s.revoked).map((s) => s.id)
    }
}

class FakeCodes implements VerificationCodeRepositoryPort {
    codes = new Map<string, { hash: string; expiresAt: Date; attempts: number; used: boolean }>()
    async replace(userId: string, purpose: CodePurpose, codeHash: string, expiresAt: Date) {
        this.codes.set(`${userId}:${purpose}`, { hash: codeHash, expiresAt, attempts: 0, used: false })
    }
    async consume(userId: string, purpose: CodePurpose, codeHash: string, now: Date, max: number): Promise<CodeCheck> {
        const code = this.codes.get(`${userId}:${purpose}`)
        if (!code || code.used) return 'invalid'
        code.attempts++
        if (code.expiresAt <= now || code.attempts > max) return 'expired'
        if (code.hash !== codeHash) return code.attempts >= max ? 'expired' : 'invalid'
        code.used = true
        return 'ok'
    }
    async deleteStale() {
        return 0
    }
}

class FakeCache implements SessionCachePort {
    endedSessions: string[] = []
    replacements = new Map<string, string>()
    async invalidateSessions(ids: string[]) {
        this.endedSessions.push(...ids)
    }
    async invalidateUser() {}
    async rememberReplacement(oldHash: string, token: string) {
        this.replacements.set(oldHash, token)
    }
    async recallReplacement(oldHash: string) {
        return this.replacements.get(oldHash) ?? null
    }
}

/** Keeps the codes it was asked to send, and who was told they already have an account. */
class FakeMailer implements AuthMailerPort {
    codes: { to: string; code: string; purpose: CodePurpose }[] = []
    accountExists: string[] = []
    async sendCode(to: string, code: string, purpose: CodePurpose) {
        this.codes.push({ to, code, purpose })
    }
    async sendAccountExists(to: string) {
        this.accountExists.push(to)
    }
    async sendAccountDeleted() {}
    async sendPasswordChanged() {}
    async sendPasswordAdded() {}
    async sendSignInMethodAdded() {}
    lastCode(to: string, purpose: CodePurpose) {
        return [...this.codes].reverse().find((c) => c.to === to && c.purpose === purpose)?.code
    }
}

/**
 * A provider that answers like Google, minus the network: `finish` checks
 * the code and that the checks are the ones `start` made, as the real
 * library does against the provider.
 */
class FakeProvider implements OAuthProviderPort {
    readonly id = 'google'
    readonly displayName = 'Google'
    identity: OAuthIdentity = { subject: 'google-sub-1', email: 'ada@example.test', emailVerified: true, name: 'Ada' }
    private issued: OAuthChecks[] = []
    async start(redirectUri: string) {
        const n = this.issued.length + 1
        const checks = { state: `state-${n}`, nonce: `nonce-${n}`, codeVerifier: `verifier-${n}` }
        this.issued.push(checks)
        return {
            authorizationUrl: `https://accounts.example/authorize?state=${checks.state}&redirect_uri=${redirectUri}`,
            checks
        }
    }
    async finish(callbackUrl: URL, redirectUri: string, checks: OAuthChecks) {
        if (callbackUrl.origin + callbackUrl.pathname !== redirectUri) throw new Error('redirect_uri mismatch')
        if (callbackUrl.searchParams.get('code') !== 'good-code') throw new Error('invalid_grant')
        if (!this.issued.some((c) => c.state === checks.state && c.nonce === checks.nonce))
            throw new Error('bad checks')
        return this.identity
    }
}

class FakeOAuthState implements OAuthStatePort {
    attempts = new Map<string, OAuthAttempt>()
    async save(attempt: OAuthAttempt) {
        this.attempts.set(attempt.checks.state, attempt)
    }
    async take(state: string) {
        const found = this.attempts.get(state)
        this.attempts.delete(state)
        return found ?? null
    }
}

class FakeOAuthAccounts implements OAuthAccountRepositoryPort {
    links: { userId: string; provider: string; subject: string }[] = []
    async providersOf(userId: string) {
        return [...new Set(this.links.filter((l) => l.userId === userId).map((l) => l.provider))].sort()
    }
    async findUserId(provider: string, subject: string) {
        return this.links.find((l) => l.provider === provider && l.subject === subject)?.userId ?? null
    }
    async link(userId: string, provider: string, subject: string) {
        const existing = await this.findUserId(provider, subject)
        if (existing) return existing === userId
        this.links.push({ userId, provider, subject })
        return true
    }
    async deleteForUser(userId: string) {
        this.links = this.links.filter((l) => l.userId !== userId)
    }
    async deleteForDeletedAccounts() {
        return 0
    }
}

const oauthSettings: OAuthSettings = { callbackBaseUrl: 'https://api.example.test/api/v1/auth', attemptTtlSeconds: 600 }

const settings: AuthSettings = {
    accessTokenTtlSeconds: 900,
    sessionTtlDays: 30,
    codeTtlMinutes: 10,
    codeMaxAttempts: 5,
    refreshGraceMs: 10_000
}

export function setup() {
    const directory = new FakeDirectory()
    const credentials = new FakeCredentials()
    const hasher = new FakeHasher()
    const limiter = new FakeLimiter()
    const tokens = new FakeTokens()
    const sessions = new FakeSessions()
    const codes = new FakeCodes()
    const cache = new FakeCache()
    const mailer = new FakeMailer()
    const events = new FakeEvents()
    const codeIssuer = new CodeIssuer(codes, tokens, mailer, settings)
    const sessionIssuer = new SessionIssuer(sessions, tokens, settings)
    const google = new FakeProvider()
    const oauthState = new FakeOAuthState()
    const oauthAccounts = new FakeOAuthAccounts()
    const gate = new SignInGate(sessionIssuer)
    const signInMethods = new SignInMethods(credentials, oauthAccounts, [google])
    // The users module's side of a deletion: what DeleteAccountHandler does.
    const usersBus = {
        execute: async (command: DeleteAccountCommand) => {
            directory.users.get(command.userId)!.deletedAt = new Date()
        }
    } as unknown as CommandBus

    return {
        events,
        directory,
        credentials,
        hasher,
        limiter,
        sessions,
        cache,
        mailer,
        google,
        oauthAccounts,
        startOAuth: new StartOAuthHandler([google], oauthState, oauthSettings),
        finishOAuth: new FinishOAuthHandler(
            [google],
            oauthState,
            oauthSettings,
            oauthAccounts,
            directory,
            credentials,
            cache,
            mailer,
            events,
            gate
        ),
        register: new RegisterHandler(
            directory,
            credentials,
            hasher,
            limiter,
            events,
            mailer,
            codeIssuer,
            signInMethods
        ),
        verify: new VerifyEmailHandler(directory, credentials, hasher, limiter, cache, events, codeIssuer, gate),
        sendPasswordSetCode: new SendPasswordSetCodeHandler(directory, limiter, signInMethods, codeIssuer),
        setPassword: new SetPasswordHandler(
            directory,
            credentials,
            hasher,
            limiter,
            mailer,
            events,
            signInMethods,
            codeIssuer
        ),
        login: new LoginHandler(directory, credentials, hasher, limiter, events, gate),
        refresh: new RefreshHandler(sessions, tokens, cache, events, settings),
        logoutEverywhere: new LogoutEverywhereHandler(sessions, cache),
        forgot: new ForgotPasswordHandler(directory, credentials, limiter, codeIssuer),
        sendDeletionCode: new SendAccountDeletionCodeHandler(directory, credentials, limiter, codeIssuer),
        deleteAccount: new DeleteOwnAccountHandler(
            directory,
            credentials,
            hasher,
            limiter,
            mailer,
            events,
            codeIssuer,
            usersBus
        ),
        reset: new ResetPasswordHandler(
            directory,
            credentials,
            sessions,
            hasher,
            cache,
            mailer,
            limiter,
            events,
            codeIssuer,
            gate
        ),
        change: new ChangePasswordHandler(directory, credentials, sessions, hasher, cache, mailer, limiter),

        /** A confirmed account with a password. */
        account(overrides: Partial<DirectoryUser> = {}, password = PASSWORD) {
            const user = directory.add(overrides)
            credentials.hashes.set(user.id, `hash:${password}`)
            return user
        },

        /** A confirmed account made with Google: no password, a Google link. */
        googleAccount(overrides: Partial<DirectoryUser> = {}) {
            const user = directory.add(overrides)
            oauthAccounts.links.push({ userId: user.id, provider: 'google', subject: `google-sub-${user.id}` })
            return user
        }
    }
}

export type World = ReturnType<typeof setup>

export const signIn = (w: World, email = 'ada@example.test', password = PASSWORD) =>
    w.login.execute(new LoginCommand(email, password, CLIENT))

/** The session a sign-in with a provider ended in. */
export function sessionOf<T extends { session: { accessToken: string } }>(outcome: T) {
    return outcome.session
}
