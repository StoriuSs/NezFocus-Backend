import { Inject, Injectable } from '@nestjs/common'
import { generateVerificationCode } from '@/shared/utils/code-generator.util'
import { AUTH_SETTINGS, AuthSettings } from '../auth-settings'
import { AUTH_MAILER, AuthMailerPort, TOKEN_SERVICE, TokenServicePort } from '../ports'
import {
    CodeCheck,
    CodeEmailWording,
    CodePurpose,
    VERIFICATION_CODE_REPOSITORY,
    VerificationCodeRepositoryPort
} from '@/modules/auth/domain'

/** Emailed codes: making one, and checking one. */
@Injectable()
export class CodeIssuer {
    constructor(
        @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepositoryPort,
        @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings
    ) {}

    /** A new code replaces any earlier one for the same purpose, then goes out by email. */
    async issue(
        userId: string,
        email: string,
        purpose: CodePurpose,
        now: Date,
        wording: CodeEmailWording = {}
    ): Promise<void> {
        const code = generateVerificationCode(6)
        const expiresAt = new Date(now.getTime() + this.settings.codeTtlMinutes * 60_000)
        await this.codes.replace(userId, purpose, this.tokens.hashVerificationCode(code, userId, purpose), expiresAt)
        await this.mailer.sendCode(email, code, purpose, this.settings.codeTtlMinutes, wording)
    }

    /** Check a code, counting the attempt; a right one is used up. */
    check(userId: string, code: string, purpose: CodePurpose, now: Date): Promise<CodeCheck> {
        return this.codes.consume(
            userId,
            purpose,
            this.tokens.hashVerificationCode(code.trim(), userId, purpose),
            now,
            this.settings.codeMaxAttempts
        )
    }
}
