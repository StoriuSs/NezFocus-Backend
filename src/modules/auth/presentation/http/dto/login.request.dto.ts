import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { EmailField, PASSWORD_INPUT_MAX } from './shared/fields.dto'

export class LoginRequestDto extends EmailField {
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string

    /** Needed from the third failed attempt when Turnstile is on (`data.captcha_required` says so). */
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    turnstileToken?: string
}
