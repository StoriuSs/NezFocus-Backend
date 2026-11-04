import { Transform } from 'class-transformer'
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { trimString } from '@/shared/utils/transform.util'
import { PASSWORD_INPUT_MAX } from './shared/fields.dto'

/**
 * Proof for deleting your own account (POST /auth/account/delete). Which
 * fields are needed depends on the account: a 400 AUTH_CONFIRMATION_REQUIRED
 * lists the missing ones.
 */
export class DeleteAccountRequestDto {
    /** The account's password; for an account that has one. */
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password?: string

    /** The six digits emailed by POST /auth/account/delete-code; for an account without a password. */
    @IsOptional()
    @Transform(trimString)
    @Matches(/^\d{6}$/, { message: 'code must be the six digits from the email' })
    code?: string

    /** With two-step sign-in on: six digits from the app, or a recovery code. */
    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MinLength(6)
    @MaxLength(32)
    twoFactorCode?: string
}
