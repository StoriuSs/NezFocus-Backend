import { applyDecorators } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsIn, IsOptional, Matches, MaxLength } from 'class-validator'
import { trimString } from '@/shared/utils/transform.util'
import { EMAIL_LANGUAGES } from '@/modules/auth/application/ports'

/*
 * Fields several /auth request bodies share. The file name ends in .dto.ts so
 * the Swagger plugin reads it: properties of a base class elsewhere are
 * missing from the API docs.
 *
 * Passwords are checked against the policy by the application, not here: the
 * rules need the address and the username, and the error names the rule.
 * The DTOs only bound the input — a password of a megabyte would still be
 * hashed otherwise.
 */

/** The longest input hashed. The policy itself caps new passwords at 128. */
export const PASSWORD_INPUT_MAX = 1024

export class EmailField {
    /** The sign-in address. Compared case-insensitively. */
    @Transform(trimString)
    @IsEmail({}, { message: 'email must be an email address' })
    @MaxLength(254)
    email: string
}

/**
 * `language`: the page's language, for the email the request sends (D-132).
 * A field of each body that emails, not a header, so it follows the language
 * switch at the foot of the page and not only the browser's setting.
 */
export const IsEmailLanguage = () =>
    applyDecorators(
        ApiPropertyOptional({
            enum: EMAIL_LANGUAGES,
            default: 'en',
            description: 'The language of the page, for the email this sends.'
        }),
        IsOptional(),
        IsIn(EMAIL_LANGUAGES, { message: 'language must be vi or en' })
    )

export class EmailCodeFields extends EmailField {
    /** The six digits from the email. */
    @Transform(trimString)
    @Matches(/^\d{6}$/, { message: 'code must be the six digits from the email' })
    code: string
}
