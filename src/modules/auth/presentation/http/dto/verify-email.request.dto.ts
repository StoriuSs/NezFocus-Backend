import { IsString, MaxLength, MinLength } from 'class-validator'
import { EmailCodeFields, PASSWORD_INPUT_MAX } from './shared/fields.dto'

export class VerifyEmailRequestDto extends EmailCodeFields {
    /**
     * The password the address was signed up with. Signing up again before
     * confirming replaces it, so only the person who chose the current one can
     * confirm the address.
     */
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string
}
