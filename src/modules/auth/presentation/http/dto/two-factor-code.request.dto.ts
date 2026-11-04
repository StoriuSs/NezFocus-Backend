import { Transform } from 'class-transformer'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { trimString } from '@/shared/utils/transform.util'

export class TwoFactorCodeRequestDto {
    /** Six digits from the authenticator app, or (where accepted) a recovery code: `K7Q2M-X9HDP`. */
    @Transform(trimString)
    @IsString()
    @MinLength(6)
    @MaxLength(32)
    code: string
}
