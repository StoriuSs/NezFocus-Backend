import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { DisableTwoFactorCommand } from './disable-two-factor.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { TWO_FACTOR_REPOSITORY, TwoFactorNotOnError, TwoFactorRepositoryPort } from '@/modules/auth/domain'
import { AUTH_EVENTS, AUTH_MAILER, AuthEventsPort, AuthMailerPort, RATE_LIMIT, RateLimitPort } from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { withGuess } from '../../services/limits'
import { refuseWrongCode, SecondFactorCheck } from '../../services/second-factor'

/**
 * Turn it off. A signed-in session is not enough: someone at an unlocked
 * computer would otherwise remove the protection in one click. A code proves
 * the person has the app or a recovery code — and works for an account with
 * no password (one made with Google). The owner is emailed.
 */
@CommandHandler(DisableTwoFactorCommand)
export class DisableTwoFactorHandler implements ICommandHandler<DisableTwoFactorCommand> {
    constructor(
        @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly secondFactor: SecondFactorCheck
    ) {}

    async execute({ userId, code }: DisableTwoFactorCommand): Promise<void> {
        const record = await this.twoFactors.find(userId)
        if (!record?.confirmed) throw new TwoFactorNotOnError()

        const user = await this.directory.findById(userId)
        await withGuess(this.limiter, [[AUTH_RATE_LIMITS.twoFactorFailuresPerUser, userId]], async (guess) => {
            const accepted = await this.secondFactor.accept(userId, code, new Date(), {
                allowRecovery: true,
                // Only the "turned off" email: not also "a recovery code was used to sign in".
                email: null
            })
            if (!accepted) refuseWrongCode(guess)
        })

        await this.twoFactors.remove(userId)
        await this.limiter.reset(AUTH_RATE_LIMITS.twoFactorFailuresPerUser, userId)
        if (user?.email) await this.mailer.sendTwoFactorChanged(user.email, false)
        this.events.record('two_factor_disabled')
    }
}
