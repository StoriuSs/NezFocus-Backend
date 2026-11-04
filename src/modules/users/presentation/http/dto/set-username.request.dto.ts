import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator'
import { Transform } from 'class-transformer'
import { USERNAME_MAX_LENGTH, USERNAME_PATTERN, normaliseUsername } from '@/modules/users/domain'

/**
 * HTTP Request DTO for setting username (one-time action).
 *
 * The pattern is strict because the username is permanent and publicly
 * displayed: spaces, `../`, RTL overrides, homoglyphs and markup are refused.
 * Property JSDoc is published in the API docs by the Swagger plugin, so keep
 * rationale like this here instead.
 */
export class SetUsernameRequestDto {
    /**
     * 3-25 lowercase letters, digits or underscores. Normalised to lower case
     * first, so `Alice` and `alice` are the same name. Permanent once set.
     */
    @Transform(({ value }) => (typeof value === 'string' ? normaliseUsername(value) : value))
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(USERNAME_MAX_LENGTH)
    @Matches(USERNAME_PATTERN, {
        message: 'username must contain only lowercase letters, numbers and underscores'
    })
    username: string
}
