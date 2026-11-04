import { Inject, Injectable, Logger } from '@nestjs/common'
import {
    normaliseRecoveryCode,
    RateLimitedError,
    TWO_FACTOR_REPOSITORY,
    TwoFactorCodeInvalidError,
    TwoFactorRepositoryPort,
    TwoFactorUnavailableError
} from '@/modules/auth/domain'
import {
    AUTH_MAILER,
    AuthMailerPort,
    SealedWithUnknownKeyError,
    SECRET_BOX,
    SecretBoxPort,
    TOTP,
    TotpPort
} from '../ports'
import { AUTH_RATE_LIMITS } from '../rate-limits'
import { Guess } from './limits'

/** Which kind of code was accepted. */
export type SecondFactor = 'app' | 'recovery'

/**
 * A wrong code on the settings page: counted against the user, like one at
 * sign-in, and answered with the tries left — or, with none left, how long
 * to wait. The guess is the one withGuess made for the user's two-step rule.
 */
export function refuseWrongCode(guess: Guess): never {
    const rule = AUTH_RATE_LIMITS.twoFactorFailuresPerUser
    guess.wrong()
    const [counted] = guess.states
    const left = rule.limit - counted.count
    if (left <= 0) throw new RateLimitedError(counted.retryAfterSeconds, rule.reason)
    throw new TwoFactorCodeInvalidError(left)
}

/**
 * Checks a second-step code: six digits from the authenticator app, or a
 * recovery code. Each is accepted once — an app code's 30-second step is
 * recorded, a recovery code is marked used — so neither can be replayed.
 * Using a recovery code emails the owner, with how many are left: the one
 * email they need if someone else has their codes.
 *
 * After a change of AUTH_ENCRYPTION_KEY (the old one in
 * AUTH_ENCRYPTION_KEY_PREVIOUS), a secret sealed with the old key is sealed
 * again with the new one the first time it is read, and recovery codes made
 * with either key are recognised. A secret no configured key sealed is
 * refused with TwoFactorUnavailableError, whatever kind of code was typed.
 */
@Injectable()
export class SecondFactorCheck {
    private readonly logger = new Logger(SecondFactorCheck.name)

    constructor(
        @Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort,
        @Inject(TOTP) private readonly totp: TotpPort,
        @Inject(SECRET_BOX) private readonly box: SecretBoxPort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort
    ) {}

    /**
     * @param email where to tell the owner a recovery code was used
     * @returns what was accepted; null for a wrong or used code
     * @throws TwoFactorUnavailableError when the secret was sealed with a key this server does not have
     */
    async accept(
        userId: string,
        code: string,
        now: Date,
        { allowRecovery, email }: { allowRecovery: boolean; email: string | null }
    ): Promise<SecondFactor | null> {
        const record = await this.twoFactors.find(userId)
        if (!record) return null
        const secret = await this.openSecret(userId, record.secretSealed)
        const trimmed = code.replace(/\s/g, '')

        if (/^\d{6}$/.test(trimmed)) {
            const step = this.totp.match(secret, trimmed, now)
            if (step === null) return null
            return (await this.twoFactors.useStep(userId, step)) ? 'app' : null
        }

        const recovery = allowRecovery ? normaliseRecoveryCode(code) : null
        if (!recovery || !record.confirmed) return null
        if (!(await this.twoFactors.useRecoveryCode(userId, this.box.fingerprints(recovery), now))) return null
        if (email) await this.mailer.sendRecoveryCodeUsed(email, await this.twoFactors.countUnusedRecoveryCodes(userId))
        return 'recovery'
    }

    /** The secret; stored again sealed with the current key when an older key sealed it. */
    private async openSecret(userId: string, sealed: string): Promise<string> {
        let opened: { plaintext: string; resealed: string | null }
        try {
            opened = this.box.open(sealed)
        } catch (error) {
            if (!(error instanceof SealedWithUnknownKeyError)) throw error
            this.logger.error(
                `Two-step sign-in cannot be checked for user ${userId}: their secret was sealed with an ` +
                    'encryption key this server does not have. If AUTH_ENCRYPTION_KEY was changed, put the old key ' +
                    'in AUTH_ENCRYPTION_KEY_PREVIOUS. If it is lost, turn two-step sign-in off for the account: ' +
                    'pnpm auth:two-factor:off <email> (docs/auth/operations.md, "Changing the encryption key").'
            )
            throw new TwoFactorUnavailableError()
        }
        if (opened.resealed) await this.twoFactors.replaceSecret(userId, sealed, opened.resealed)
        return opened.plaintext
    }
}
