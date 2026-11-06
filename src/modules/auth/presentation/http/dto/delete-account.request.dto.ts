import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { EmailLanguage } from '@/modules/auth/application/ports'
import { IsEmailLanguage, PASSWORD_INPUT_MAX } from './shared/fields.dto'

/**
 * Proof for deleting your own account (POST /auth/account/delete): the
 * password. Missing, a 400 AUTH_CONFIRMATION_REQUIRED says so.
 */
export class DeleteAccountRequestDto {
    /** The account's password. */
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password?: string

    @IsEmailLanguage()
    language?: EmailLanguage
}
