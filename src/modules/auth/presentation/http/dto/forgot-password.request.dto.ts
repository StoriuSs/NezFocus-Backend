import { IsOptional, IsString, MaxLength } from 'class-validator'
import { EmailField } from './shared/fields.dto'

export class ForgotPasswordRequestDto extends EmailField {
    /** Required when Turnstile is on. */
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    turnstileToken?: string
}
