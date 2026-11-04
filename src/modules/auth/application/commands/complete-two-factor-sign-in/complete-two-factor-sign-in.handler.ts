import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { CompleteTwoFactorSignInCommand } from './complete-two-factor-sign-in.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountDisabledError,
    RateLimitedError,
    TwoFactorChallengeExpiredError,
    TwoFactorCodeInvalidError
} from '@/modules/auth/domain'
import {
    AUTH_EVENTS,
    AuthEventsPort,
    TWO_FACTOR_CHALLENGE,
    TwoFactorChallengePort,
    RATE_LIMIT,
    RateLimitPort
} from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { withGuess } from '../../services/limits'
import { SecondFactorCheck } from '../../services/second-factor'
import { IssuedSession, SessionIssuer } from '../../services/session-issuer'
import { TWO_FACTOR_CHALLENGE_ATTEMPTS } from '../../services/sign-in-gate'

/**
 * The second step of signing in: the challenge the first step handed out, and
 * a code. A wrong code costs one of the challenge's five attempts and counts
 * against the user (five per fifteen minutes, across challenges), so a stolen
 * password does not buy a million guesses. Each code is counted before it is
 * checked (withGuess), so a burst sent all at once gets five tries, not a
 * hundred. The last attempt ends the
 * challenge: the sign-in starts over. When it was the user's last one, the
 * answer says how long to wait instead — signing in again straight away
 * would only be refused after the password.
 */
@CommandHandler(CompleteTwoFactorSignInCommand)
export class CompleteTwoFactorSignInHandler implements ICommandHandler<CompleteTwoFactorSignInCommand> {
    constructor(
        @Inject(TWO_FACTOR_CHALLENGE) private readonly challenges: TwoFactorChallengePort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly secondFactor: SecondFactorCheck,
        private readonly sessionIssuer: SessionIssuer
    ) {}

    async execute(command: CompleteTwoFactorSignInCommand): Promise<IssuedSession> {
        const userId = command.challenge ? await this.challenges.find(command.challenge) : null
        if (!userId) throw new TwoFactorChallengeExpiredError()
        const rule = AUTH_RATE_LIMITS.twoFactorFailuresPerUser

        return withGuess(this.limiter, [[rule, userId]], async (guess) => {
            const user = await this.directory.findById(userId)
            if (!user || user.deletedAt) {
                await this.challenges.take(command.challenge)
                throw new AccountDisabledError()
            }

            const now = new Date()
            const accepted = await this.secondFactor.accept(userId, command.code, now, {
                allowRecovery: true,
                email: user.email
            })
            if (!accepted) {
                guess.wrong()
                const [counted] = guess.states
                this.events.record('two_factor_failed')
                const left = await this.challenges.recordFailure(command.challenge, TWO_FACTOR_CHALLENGE_ATTEMPTS)
                const leftForUser = rule.limit - counted.count
                if (leftForUser <= 0) {
                    await this.challenges.take(command.challenge)
                    throw new RateLimitedError(counted.retryAfterSeconds, rule.reason)
                }
                if (left === 0) throw new TwoFactorChallengeExpiredError()
                // Whichever runs out first: this challenge's tries, or the user's.
                throw new TwoFactorCodeInvalidError(Math.min(left, leftForUser))
            }

            // Taken once: two requests racing with the same right code cannot
            // both come away with a session.
            if (!(await this.challenges.take(command.challenge))) throw new TwoFactorChallengeExpiredError()
            await this.limiter.reset(rule, userId)
            this.events.record('login_succeeded')
            return this.sessionIssuer.start(userId, command.client, now)
        })
    }
}
