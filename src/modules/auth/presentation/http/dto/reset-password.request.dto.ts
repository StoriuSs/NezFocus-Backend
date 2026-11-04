import { IsString, MaxLength, MinLength } from 'class-validator'
import { EmailCodeFields, PASSWORD_INPUT_MAX } from './shared/fields.dto'

export class ResetPasswordRequestDto extends EmailCodeFields {
    /** The new password. */
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string
}
