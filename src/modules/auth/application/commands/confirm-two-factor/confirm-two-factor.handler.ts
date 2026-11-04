import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { ConfirmTwoFactorCommand } from './confirm-two-factor.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    newRecoveryCodes,
    normaliseRecoveryCode,
    TWO_FACTOR_REPOSITORY,
    TwoFactorAlreadyOnError,
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
 * Step two: a code from the app proves it has the secret. Two-step sign-in is
 * on from here; the recovery codes are made, and returned this once — only
 * their fingerprints are kept.
 */
@CommandHandler(ConfirmTwoFactorCommand)
export class ConfirmTwoFactorHandler implements ICommandHandler<ConfirmTwoFactorCommand> {
    constructor(
        @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(SECRET_BOX) private readonly box: SecretBoxPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(RATE_LIMIT) private readonly limiter: RateLimitPort,
        @Inject(AUTH_EVENTS) private readonly events: AuthEventsPort,
        private readonly secondFactor: SecondFactorCheck
    ) {}

    async execute({ userId, code }: ConfirmTwoFactorCommand): Promise<{ recoveryCodes: string[] }> {
        const record = await this.twoFactors.find(userId)
        if (!record) throw new TwoFactorNotOnError('Set up two-step verification first.')
        if (record.confirmed) throw new TwoFactorAlreadyOnError()

        const now = new Date()
        await withGuess(this.limiter, [[AUTH_RATE_LIMITS.twoFactorFailuresPerUser, userId]], async (guess) => {
            if (!(await this.secondFactor.accept(userId, code, now, { allowRecovery: false, email: null }))) {
                refuseWrongCode(guess)
            }
        })
        if (!(await this.twoFactors.confirm(userId, now))) throw new TwoFactorAlreadyOnError()

        const recoveryCodes = newRecoveryCodes()
        await this.twoFactors.replaceRecoveryCodes(
            userId,
            recoveryCodes.map((recoveryCode) => this.box.fingerprint(normaliseRecoveryCode(recoveryCode)!))
        )
        await this.limiter.reset(AUTH_RATE_LIMITS.twoFactorFailuresPerUser, userId)
        const user = await this.directory.findById(userId)
        if (user?.email) await this.mailer.sendTwoFactorChanged(user.email, true)
        this.events.record('two_factor_enabled')
        return { recoveryCodes }
    }
}
