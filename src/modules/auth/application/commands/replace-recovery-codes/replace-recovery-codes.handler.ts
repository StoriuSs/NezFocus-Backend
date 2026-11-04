import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { ReplaceRecoveryCodesCommand } from './replace-recovery-codes.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    newRecoveryCodes,
    normaliseRecoveryCode,
    TWO_FACTOR_REPOSITORY,
    TwoFactorNotOnError,
    TwoFactorRepositoryPort
} from '@/modules/auth/domain'
import {
    AUTH_EVENTS,
    AUTH_MAILER,
    AuthEventsPort,
    AuthMailerPort,
    SECRET_BOX,
    SecretBoxPort,
    RATE_LIMIT,
    RateLimitPort
} from '../../ports'
import { AUTH_RATE_LIMITS } from '../../rate-limits'
import { withGuess } from '../../services/limits'
import { refuseWrongCode, SecondFactorCheck } from '../../services/second-factor'

/**
 * New recovery codes, for someone who lost theirs or has used most of them:
 * every earlier code stops working, and the new ones are returned this once.
 * Takes a code from the app — a signed-in session alone must not be able to
 * mint new ways in — and the owner is emailed.
 */
@CommandHandler(ReplaceRecoveryCodesCommand)
export class ReplaceRecoveryCodesHandler implements ICommandHandler<ReplaceRecoveryCodesCommand> {
    constructor(
        @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(SECRET_BOX) private readonly box: SecretBoxPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly secondFactor: SecondFactorCheck
    ) {}

    async execute({ userId, code }: ReplaceRecoveryCodesCommand): Promise<{ recoveryCodes: string[] }> {
        const record = await this.twoFactors.find(userId)
        if (!record?.confirmed) throw new TwoFactorNotOnError()

        await withGuess(this.limiter, [[AUTH_RATE_LIMITS.twoFactorFailuresPerUser, userId]], async (guess) => {
            if (!(await this.secondFactor.accept(userId, code, new Date(), { allowRecovery: false, email: null }))) {
                refuseWrongCode(guess)
            }
        })

        const recoveryCodes = newRecoveryCodes()
        await this.twoFactors.replaceRecoveryCodes(
            userId,
            recoveryCodes.map((recoveryCode) => this.box.fingerprint(normaliseRecoveryCode(recoveryCode)!))
        )
        await this.limiter.reset(AUTH_RATE_LIMITS.twoFactorFailuresPerUser, userId)
        const user = await this.directory.findById(userId)
        if (user?.email) await this.mailer.sendRecoveryCodesReplaced(user.email)
        this.events.record('recovery_codes_replaced')
        return { recoveryCodes }
    }
}
