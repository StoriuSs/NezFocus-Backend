import { Transform } from 'class-transformer'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { trimString } from '@/shared/utils/transform.util'
import { PASSWORD_INPUT_MAX } from './shared/fields.dto'

/** A first password, with the code emailed for it (POST /auth/password/code). */
export class SetPasswordRequestDto {
    /** The six digits from the email. */
    @Transform(trimString)
    @Matches(/^\d{6}$/, { message: 'code must be the six digits from the email' })
    code: string

    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    newPassword: string
}
