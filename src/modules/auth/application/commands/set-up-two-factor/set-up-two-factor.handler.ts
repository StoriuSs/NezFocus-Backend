import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { SetUpTwoFactorCommand } from './set-up-two-factor.command'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    AccountDisabledError,
    TWO_FACTOR_REPOSITORY,
    TwoFactorAlreadyOnError,
    TwoFactorRepositoryPort
} from '@/modules/auth/domain'
import { SECRET_BOX, SecretBoxPort, TOTP, TotpPort } from '../../ports'
import { TWO_FACTOR_SETTINGS, TwoFactorSettings } from '../../two-factor-settings'

export interface TwoFactorSetUp {
    /** For typing into the app by hand, when the QR code cannot be scanned. */
    secret: string
    /** The QR code's content. */
    otpauthUri: string
}

/**
 * Step one of turning it on: a new secret, not yet asked for at sign-in. It
 * becomes real only when a code from the app confirms the app has it
 * (ConfirmTwoFactorHandler); until then, setting up again replaces it.
 */
@CommandHandler(SetUpTwoFactorCommand)
export class SetUpTwoFactorHandler implements ICommandHandler<SetUpTwoFactorCommand> {
    constructor(
        @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly directory: UserDirectoryPort,
        @Inject(TOTP) private readonly totp: TotpPort,
        @Inject(SECRET_BOX) private readonly box: SecretBoxPort,
        @Inject(TWO_FACTOR_SETTINGS) private readonly settings: TwoFactorSettings
    ) {}

    async execute({ userId }: SetUpTwoFactorCommand): Promise<TwoFactorSetUp> {
        const user = await this.directory.findById(userId)
        if (!user || user.deletedAt) throw new AccountDisabledError()
        const secret = this.totp.newSecret()
        if (!(await this.twoFactors.saveUnconfirmed(userId, this.box.seal(secret)))) {
            throw new TwoFactorAlreadyOnError()
        }
        return { secret, otpauthUri: this.totp.uri(secret, user.email ?? user.id, this.settings.issuer) }
    }
}
