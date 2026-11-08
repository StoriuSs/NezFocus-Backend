import { IsString, MaxLength, MinLength } from 'class-validator'
import type { EmailLanguage } from '@/modules/auth/application/ports'
import { IsEmailLanguage, PASSWORD_INPUT_MAX } from './shared/fields.dto'

/**
 * Deleting your own account (POST /auth/account/delete): the password is the
 * proof it is the owner. Missing, the answer is VALIDATION_ERROR.
 */
export class DeleteAccountRequestDto {
    /** The account's password. */
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password!: string

    @IsEmailLanguage()
    language?: EmailLanguage
}
