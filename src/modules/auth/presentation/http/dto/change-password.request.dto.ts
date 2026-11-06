import { IsString, MaxLength, MinLength } from 'class-validator'
import type { EmailLanguage } from '@/modules/auth/application/ports'
import { IsEmailLanguage, PASSWORD_INPUT_MAX } from './shared/fields.dto'

export class ChangePasswordRequestDto {
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    currentPassword: string

    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    newPassword: string

    @IsEmailLanguage()
    language?: EmailLanguage
}
