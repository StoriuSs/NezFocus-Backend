import { Injectable } from '@nestjs/common'
import { IssuedSession, SessionIssuer } from './session-issuer'

/**
 * The one way into a session once the first step is done — a password, an
 * emailed code, or Google. Every sign-in path ends here, so a rule that must
 * hold for all of them (an account still being completed, a deletion to
 * cancel) has one place to live.
 */
@Injectable()
export class SignInGate {
    constructor(private readonly sessionIssuer: SessionIssuer) {}

    async pass(userId: string, client: { ip?: string; userAgent?: string }, now: Date): Promise<IssuedSession> {
        return this.sessionIssuer.start(userId, client, now)
    }
}
