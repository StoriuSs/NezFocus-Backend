import { IsOptional, IsString, MaxLength } from 'class-validator'
import { TwoFactorCodeRequestDto } from './two-factor-code.request.dto'

export class TwoFactorSignInRequestDto extends TwoFactorCodeRequestDto {
    /**
     * The challenge from the 403 AUTH_TWO_FACTOR_REQUIRED answer. Omitted after
     * signing in with Google: the challenge is then in a cookie.
     */
    @IsOptional()
    @IsString()
    @MaxLength(256)
    challenge?: string
}
