import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { VerifyEmailCodeCommand } from './verify-email-code.command'
import { DirectoryUser, normaliseEmail, USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { CodeExpiredError, CodeInvalidError } from '@/modules/auth/domain'
import { AUTH_EVENTS, AuthEventsPort, RATE_LIMIT, RateLimitPort } from '../../ports'
import { AUTH_RATE_LIMITS, RateLimitRule } from '../../rate-limits'
import { CodeIssuer } from '../../services/code-issuer'
import { IssuedSession } from '../../services/session-issuer'
import { SignInGate } from '../../services/sign-in-gate'
import { withGuess } from '../../services/limits'

/** A sign-in with a code, and what the page needs to know about the account. */
export interface EmailCodeSignIn {
    session: IssuedSession
    account: {
        /** Made by this sign-in: the address had no account. */
        created: boolean
        /** Done the "complete your account" step; if not, the page opens it (D-61). */
        completed: boolean
    }
}

/**
 * Sign in with the emailed code (REQ-AUTH-01, REQ-AUTH-02). The right code
 * proves the person reads the inbox, so:
 *
 * - an address with an account signs in to it;
 * - an address without one gets one now: confirmed by this code, with no
 *   password, username or settings yet — "not completed" (D-59, D-61).
 *
 * Every guess counts against two limits while it is checked (withGuess):
 * wrong codes per IP, and wrong codes per address across all its codes
 * (D-134). Each code also dies on its fifth wrong guess. A right code is used
 * up before the account is touched, so one code makes one session.
 */
@CommandHandler(VerifyEmailCodeCommand)
export class VerifyEmailCodeHandler implements ICommandHandler<VerifyEmailCodeCommand> {
    constructor(
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly codeIssuer: CodeIssuer,
        private readonly gate: SignInGate
    ) {}

    async execute({ email, code, client }: VerifyEmailCodeCommand): Promise<EmailCodeSignIn> {
        const address = normaliseEmail(email)
        const now = new Date()
        const guesses: [RateLimitRule, string][] = [
            [AUTH_RATE_LIMITS.codeAttemptsPerIp, client.ip],
            [AUTH_RATE_LIMITS.codeFailuresPerEmail, address]
        ]
        await withGuess(this.limiter, guesses, async (guess) => {
            const result = await this.codeIssuer.check(address, code, 'sign-in', now)
            if (result !== 'right') {
                guess.wrong()
                throw result === 'expired' ? new CodeExpiredError() : new CodeInvalidError()
            }
            // Right, but another request with it got there first.
            if (!(await this.codeIssuer.use(address, code, 'sign-in', now))) throw new CodeInvalidError()
        })

        const { user, created } = await this.accountFor(address)
        if (created) this.events.record('registration')
        this.events.record('login_succeeded')
        const session = await this.gate.pass(user.id, client, now)
        return { session, account: { created, completed: user.completedAt !== null } }
    }

    /**
     * The address's account, or a new one. Two sign-ups for one address meet
     * at the database's unique index: the one that lost signs in to the
     * winner's account. Twice, in case that account was deleted in between.
     */
    private async accountFor(address: string): Promise<{ user: DirectoryUser; created: boolean }> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const existing = await this.directory.findByEmail(address)
            if (existing) return { user: existing, created: false }
            const made = await this.directory.create(address, null)
            if (made) return { user: made, created: true }
        }
        throw new Error('The account for this address could not be found or made')
    }
}
