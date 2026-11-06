import { IsString, MaxLength, MinLength } from 'class-validator'
import type { EmailLanguage } from '@/modules/auth/application/ports'
import { EmailCodeFields, IsEmailLanguage, PASSWORD_INPUT_MAX } from './shared/fields.dto'

export class ResetPasswordRequestDto extends EmailCodeFields {
    /** The new password. */
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string

    @IsEmailLanguage()
    language?: EmailLanguage
}
