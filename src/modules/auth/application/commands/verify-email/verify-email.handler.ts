import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { VerifyEmailCommand } from './verify-email.command'
import { normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CodeExpiredError,
    CodeInvalidError,
    CREDENTIAL_REPOSITORY,
    CredentialRepositoryPort
} from '@/modules/auth/domain'
import {
    AUTH_EVENTS,
    AuthEventsPort,
    PASSWORD_HASHER,
    PasswordHasherPort,
    SESSION_CACHE,
    SessionCachePort,
    RATE_LIMIT,
    RateLimitPort
} from '../../ports'
import { AUTH_RATE_LIMITS, RateLimitRule } from '../../rate-limits'
import { CodeIssuer } from '../../services/code-issuer'
import { IssuedSession } from '../../services/session-issuer'
import { SignInGate } from '../../services/sign-in-gate'
import { withGuess } from '../../services/limits'

/** Said for a wrong code and a wrong password alike. */
const CODE_OR_PASSWORD_WRONG =
    'That code, or the password, is not right. Use the newest code, and the password from your last sign-up.'

/**
 * Confirm an address with the code emailed to it and the password it was
 * signed up with, and sign in.
 *
 * Why the password: signing up again with an address that is not confirmed
 * yet replaces its password (for someone who forgot the one they chose), and
 * emails the address a new code. With the code alone, someone who knew the
 * address could sign it up again, with their own password, before its owner
 * confirmed it. The owner would then confirm an account whose password the
 * other person holds. Asking for the password here makes the owner's
 * confirmation fail instead; signing up again puts their password back.
 *
 * A wrong password is the same answer as a wrong code, so this cannot test
 * passwords, or find accounts: an unknown address and an already-confirmed one
 * are that answer too. A wrong password does not use up one of the code's
 * tries: a slip of the keyboard should not cost an email.
 *
 * Signing in here gives nothing away: the caller has the password and reads
 * the inbox.
 */
@CommandHandler(VerifyEmailCommand)
export class VerifyEmailHandler implements ICommandHandler<VerifyEmailCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(SESSION_CACHE) private readonly cache: SessionCachePort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly codeIssuer: CodeIssuer,
        private readonly gate: SignInGate
    ) {}

    execute(command: VerifyEmailCommand): Promise<IssuedSession> {
        const guesses: [RateLimitRule, string][] = [[AUTH_RATE_LIMITS.codeAttemptsPerIp, command.client.ip]]
        return withGuess(this.limiter, guesses, async (guess) => {
            const user = await this.directory.findByEmail(normaliseEmail(command.email))
            const hash = user ? await this.credentials.findHash(user.id) : null
            // An unknown address still runs a hash: the same time, the same answer.
            let passwordRight = false
            if (hash) passwordRight = await this.hasher.verify(hash, command.password)
            else await this.hasher.verifyDummy(command.password)

            const now = new Date()
            const result =
                user && passwordRight
                    ? await this.codeIssuer.check(user.id, command.code, 'email-verify', now)
                    : 'invalid'
            if (!user || result !== 'ok') {
                guess.wrong()
                throw result === 'expired' ? new CodeExpiredError() : new CodeInvalidError(CODE_OR_PASSWORD_WRONG)
            }

            await this.directory.markEmailVerified(user.id)
            await this.cache.invalidateUser(user.id)
            this.events.record('login_succeeded')
            return this.gate.pass(user.id, command.client, now)
        })
    }
}
