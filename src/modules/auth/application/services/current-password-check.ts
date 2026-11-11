import { Inject, Injectable } from '@nestjs/common'
import { CREDENTIAL_REPOSITORY, CredentialRepositoryPort, CurrentPasswordInvalidError } from '@/modules/auth/domain'
import { CurrentPasswordPort, PASSWORD_HASHER, PasswordHasherPort, RATE_LIMIT, RateLimitPort } from '../ports'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { withGuess } from './limits'

/**
 * The account's password checked again, for another module (handing a
 * server over, D-160), as changing it checks it: wrong ones count against
 * the same rule (`currentPasswordFailuresPerUser`), so changing the password,
 * deleting the account and handing a server over share one budget, and the
 * right one forgets the wrong ones before it.
 */
@Injectable()
export class CurrentPasswordCheck implements CurrentPasswordPort {
    constructor(
        @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepositoryPort,
        @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort
    ) {}

    async confirm(userId: string, password: string): Promise<void> {
        const rule = AUTH_RATE_LIMITS.currentPasswordFailuresPerUser
        const hash = await this.credentials.findHash(userId)
        await withGuess(this.limiter, [[rule, userId]], async (guess) => {
            // An account without a password has no proof to give: every guess is wrong.
            if (hash === null || !(await this.hasher.verify(hash, password))) {
                guess.wrong()
                throw new CurrentPasswordInvalidError()
            }
        })
        await this.limiter.reset(rule, userId)
    }
}
