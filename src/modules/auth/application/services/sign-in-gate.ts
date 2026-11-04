import { Inject, Injectable } from '@nestjs/common'
import { TWO_FACTOR_REPOSITORY, TwoFactorRepositoryPort, TwoFactorRequiredError } from '@/modules/auth/domain'
import { TWO_FACTOR_CHALLENGE, TwoFactorChallengePort } from '../ports'
import { IssuedSession, SessionIssuer } from './session-issuer'

/** How long someone has to enter the code once the first step is done. */
export const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 300
/** Wrong codes one challenge allows before the sign-in starts over. */
export const TWO_FACTOR_CHALLENGE_ATTEMPTS = 5

/** A sign-in's first step is done: either a session, or the second step to take. */
export type SignInOutcome = { session: IssuedSession } | { challenge: string }

/**
 * The one way into a session once the first step is done — a password, an
 * emailed code, or Google. With two-step sign-in on, it hands back a
 * challenge instead: the code from the authenticator app comes next
 * (CompleteTwoFactorSignInHandler). No path can start a session around it.
 */
@Injectable()
export class SignInGate {
    constructor(
        @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort,
        @Inject(TWO_FACTOR_CHALLENGE) private readonly challenges: TwoFactorChallengePort,
        private readonly sessionIssuer: SessionIssuer
    ) {}

    async pass(userId: string, client: { ip?: string; userAgent?: string }, now: Date): Promise<SignInOutcome> {
        const twoFactor = await this.twoFactors.find(userId)
        if (twoFactor?.confirmed) {
            return { challenge: await this.challenges.create(userId, TWO_FACTOR_CHALLENGE_TTL_SECONDS) }
        }
        return { session: await this.sessionIssuer.start(userId, client, now) }
    }

    /** For the routes that answer with a session: the challenge travels as a 403 the client expects. */
    async passOrChallenge(
        userId: string,
        client: { ip?: string; userAgent?: string },
        now: Date
    ): Promise<IssuedSession> {
        const outcome = await this.pass(userId, client, now)
        if ('challenge' in outcome) throw new TwoFactorRequiredError(outcome.challenge)
        return outcome.session
    }
}
