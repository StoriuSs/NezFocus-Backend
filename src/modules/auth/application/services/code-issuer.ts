import { Inject, Injectable } from '@nestjs/common'
import { generateVerificationCode } from '@/shared/utils/code-generator.util'
import { AUTH_SETTINGS, AuthSettings } from '../auth-settings'
import { AUTH_MAILER, AuthMailerPort, CodeEmail, TOKEN_SERVICE, TokenServicePort } from '../ports'
import {
    CodeCheck,
    CodePurpose,
    VERIFICATION_CODE_REPOSITORY,
    VerificationCodeRepositoryPort
} from '@/modules/auth/domain'

/** Emailed codes, by address (D-129): making one, checking a guess, using one up. */
@Injectable()
export class CodeIssuer {
    constructor(
        @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepositoryPort,
        @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
        @Inject(AUTH_MAILER) private readonly mailer: AuthMailerPort,
        @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings
    ) {}

    /**
     * A new code replaces any earlier one for the address and purpose, then
     * goes out by email.
     *
     * @param email how the email is worded; null to store the code and send
     *   nothing — a reset asked for an address with no account still gets a
     *   code nobody knows, so guesses at it run out exactly as for any other
     *   address (D-121)
     * @param whenMailFails given: an email that cannot be queued is handed to
     *   it instead of failing the request (the code is stored either way)
     */
    async issue(
        address: string,
        purpose: CodePurpose,
        now: Date,
        email: CodeEmail | null,
        whenMailFails?: (error: unknown) => void
    ): Promise<void> {
        const code = generateVerificationCode(6)
        const expiresAt = new Date(now.getTime() + this.settings.codeTtlMinutes * 60_000)
        await this.codes.replace(address, purpose, this.hash(code, address, purpose), expiresAt)
        if (!email) return
        try {
            await this.mailer.sendCode(address, code, purpose, this.settings.codeTtlMinutes, email)
        } catch (error) {
            if (!whenMailFails) throw error
            whenMailFails(error)
        }
    }

    /** Check a guess, counting it as one of the code's tries. A right one is not used up yet. */
    check(address: string, code: string, purpose: CodePurpose, now: Date): Promise<CodeCheck> {
        return this.codes.check(
            address,
            purpose,
            this.hash(code.trim(), address, purpose),
            now,
            this.settings.codeMaxAttempts
        )
    }

    /** Use up a code `check` found right. False: another request used it first, or a newer one replaced it. */
    use(address: string, code: string, purpose: CodePurpose, now: Date): Promise<boolean> {
        return this.codes.use(address, purpose, this.hash(code.trim(), address, purpose), now)
    }

    private hash(code: string, address: string, purpose: CodePurpose): string {
        return this.tokens.hashVerificationCode(code, address, purpose)
    }
}
