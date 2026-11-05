import { IsString, MaxLength, MinLength } from 'class-validator'
import { EmailField, PASSWORD_INPUT_MAX } from './shared/fields.dto'

export class LoginRequestDto extends EmailField {
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string
}
