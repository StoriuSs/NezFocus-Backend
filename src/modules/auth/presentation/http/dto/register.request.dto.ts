import { IsString, MaxLength, MinLength } from 'class-validator'
import { EmailField, PASSWORD_INPUT_MAX } from './shared/fields.dto'

export class RegisterRequestDto extends EmailField {
    /** At least 8 characters with an upper-case letter, a lower-case letter, a digit and a symbol. */
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string
}
